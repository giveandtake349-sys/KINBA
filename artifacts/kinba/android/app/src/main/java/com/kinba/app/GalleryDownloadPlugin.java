package com.kinba.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * "Download image" for the photo viewer: writes the photo into the device
 * gallery (Android MediaStore → Pictures/KINBA) so it shows up in the system
 * Photos / Gallery apps.
 *
 * Storage model:
 * - API 29+ (Android 10 … 13+): app-owned MediaStore insert with RELATIVE_PATH
 *   and IS_PENDING. No runtime permission is required on any Android 13+
 *   device, and nothing needs legacy storage flags.
 * - API 24–28 (Android 7–9): legacy public Pictures write, gated on the
 *   WRITE_EXTERNAL_STORAGE runtime permission (declared with maxSdkVersion 28
 *   in the manifest), followed by a media scan so the gallery indexes it.
 *
 * Quality: bytes are copied verbatim — no resize, no re-encode.
 * Success: the call only resolves after the bytes are committed (IS_PENDING
 * cleared, or the file flushed + scanned), so the web layer can only toast
 * success on a real save.
 */
@CapacitorPlugin(
    name = "GalleryDownload",
    permissions = {
        @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class GalleryDownloadPlugin extends Plugin {

    private static final String STORAGE_ALIAS = "storage";
    private static final String GALLERY_FOLDER = "KINBA";
    private static final long MAX_IMAGE_BYTES = 25L * 1024 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    /**
     * Saves the given image URL into the device gallery.
     * Runs on the Capacitor plugin thread (Bridge.taskHandler), never the UI thread.
     */
    @PluginMethod
    public void saveImage(PluginCall call) {
        String url = requireImageUrl(call);
        if (url == null) {
            return;
        }
        if (!hasStoragePermission()) {
            // Resume this same call from the permission callback below.
            bridge.executeOnMainThread(() ->
                requestPermissionForAlias(STORAGE_ALIAS, call, "onStoragePermission")
            );
            return;
        }
        persist(call, url);
    }

    /** Called after the WRITE_EXTERNAL_STORAGE prompt on API 24–28. */
    @PermissionCallback
    public void onStoragePermission(PluginCall call) {
        if (!hasStoragePermission()) {
            call.reject(
                "Storage permission was denied. Allow storage access in Android Settings to save this photo.",
                "PERMISSION_DENIED"
            );
            return;
        }
        String url = requireImageUrl(call);
        if (url == null) {
            return;
        }
        persist(call, url);
    }

    private String requireImageUrl(PluginCall call) {
        String raw = call.getString("url");
        if (raw == null) {
            call.reject("This photo has no downloadable link.", "NO_URL");
            return null;
        }
        String url = raw.trim();
        if (url.isEmpty()) {
            call.reject("This photo has no downloadable link.", "NO_URL");
            return null;
        }
        String lower = url.toLowerCase(Locale.US);
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            call.reject("This photo cannot be downloaded.", "UNSUPPORTED_URL");
            return null;
        }
        return url;
    }

    private boolean hasStoragePermission() {
        // Android 10+ (incl. 13+): inserting your own images into MediaStore
        // requires no permission.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return true;
        }
        return getPermissionState(STORAGE_ALIAS) == PermissionState.GRANTED;
    }

    private void persist(PluginCall call, String url) {
        try {
            byte[] bytes = download(url);
            if (bytes.length == 0) {
                call.reject("The photo came back empty.", "EMPTY_IMAGE");
                return;
            }
            String mime = detectImageMime(bytes, url);
            if (mime == null) {
                call.reject("That link is not an image.", "NOT_AN_IMAGE");
                return;
            }
            String fileName = buildFileName(url, mime);
            Uri uri = writeToGallery(bytes, mime, fileName);

            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            result.put("name", fileName);
            result.put("mime", mime);
            call.resolve(result);
        } catch (Exception error) {
            String detail = error.getMessage();
            call.reject(
                "Could not save this photo: " +
                    (detail == null || detail.trim().isEmpty()
                        ? error.getClass().getSimpleName()
                        : detail.trim()),
                "SAVE_FAILED",
                error
            );
        }
    }

    private static byte[] download(String source) throws IOException {
        URL url = new URL(source);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "image/*,*/*;q=0.8");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("the server replied with status " + status);
            }
            InputStream input = connection.getInputStream();
            try {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[16 * 1024];
                long total = 0;
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_IMAGE_BYTES) {
                        throw new IOException("the photo is larger than 25 MB");
                    }
                    output.write(buffer, 0, read);
                }
                return output.toByteArray();
            } finally {
                input.close();
            }
        } finally {
            connection.disconnect();
        }
    }

    /** Sniffs the bytes first so videos/Shorts can never be stored as photos. */
    private static String detectImageMime(byte[] bytes, String source) {
        if (bytes.length > 3
            && (bytes[0] & 0xFF) == 0xFF
            && (bytes[1] & 0xFF) == 0xD8
            && (bytes[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (bytes.length > 3
            && (bytes[0] & 0xFF) == 0x89
            && bytes[1] == 'P'
            && bytes[2] == 'N'
            && bytes[3] == 'G') {
            return "image/png";
        }
        if (bytes.length > 5
            && bytes[0] == 'G'
            && bytes[1] == 'I'
            && bytes[2] == 'F'
            && bytes[3] == '8') {
            return "image/gif";
        }
        if (bytes.length > 11
            && bytes[0] == 'R'
            && bytes[1] == 'I'
            && bytes[2] == 'F'
            && bytes[3] == 'F'
            && bytes[8] == 'W'
            && bytes[9] == 'E'
            && bytes[10] == 'B'
            && bytes[11] == 'P') {
            return "image/webp";
        }
        if (bytes.length > 11
            && bytes[4] == 'f'
            && bytes[5] == 't'
            && bytes[6] == 'y'
            && bytes[7] == 'p') {
            String brand = new String(bytes, 8, 4, StandardCharsets.US_ASCII);
            if ("avif".equals(brand) || "avis".equals(brand)) {
                return "image/avif";
            }
            if ("heic".equals(brand)
                || "heix".equals(brand)
                || "hevc".equals(brand)
                || "mif1".equals(brand)
                || "msf1".equals(brand)) {
                return "image/heic";
            }
        }
        if (bytes.length > 1 && bytes[0] == 'B' && bytes[1] == 'M') {
            return "image/bmp";
        }
        String extension = MimeTypeMap.getFileExtensionFromUrl(source);
        if (extension != null && !extension.isEmpty()) {
            String byExtension = MimeTypeMap.getSingleton()
                .getMimeTypeFromExtension(extension.toLowerCase(Locale.US));
            if (byExtension != null && byExtension.startsWith("image/")) {
                return normalizeMime(byExtension);
            }
        }
        return null;
    }

    private static String normalizeMime(String mime) {
        String lower = mime.toLowerCase(Locale.US);
        if ("image/jpg".equals(lower) || "image/pjpeg".equals(lower)) {
            return "image/jpeg";
        }
        return lower;
    }

    private static String buildFileName(String source, String mime) {
        String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(normalizeMime(mime));
        if (extension == null || extension.isEmpty()) {
            extension = "jpg";
        }
        String base = "image";
        try {
            String path = new URL(source).getPath();
            if (path != null) {
                int slash = path.lastIndexOf('/');
                String last = slash >= 0 ? path.substring(slash + 1) : path;
                if (last != null && !last.isEmpty()) {
                    int dot = last.lastIndexOf('.');
                    if (dot > 0) {
                        last = last.substring(0, dot);
                    }
                    last = URLDecoder.decode(last, "UTF-8")
                        .replaceAll("[^A-Za-z0-9_-]", "_");
                    if (!last.isEmpty() && !"image".equals(last)) {
                        base = last;
                    }
                }
            }
        } catch (Exception ignored) {
            // Keep the generic base name when the URL cannot be parsed.
        }
        if (base.length() > 40) {
            base = base.substring(0, 40);
        }
        String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        return "KINBA_" + stamp + "_" + base + "." + extension;
    }

    private Uri writeToGallery(byte[] bytes, String mime, String fileName) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return writeToMediaStore(bytes, mime, fileName);
        }
        return writeToLegacyPictures(bytes, mime, fileName);
    }

    /** Android 10+ — MediaStore insert into Pictures/KINBA, no permission. */
    private Uri writeToMediaStore(byte[] bytes, String mime, String fileName) throws IOException {
        Context context = getContext();
        ContentResolver resolver = context.getContentResolver();

        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, mime);
        values.put(
            MediaStore.Images.Media.RELATIVE_PATH,
            Environment.DIRECTORY_PICTURES + File.separator + GALLERY_FOLDER
        );
        values.put(MediaStore.Images.Media.IS_PENDING, 1);

        Uri item = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (item == null) {
            throw new IOException("Android did not create a gallery entry");
        }
        try {
            OutputStream output = resolver.openOutputStream(item);
            if (output == null) {
                throw new IOException("Android could not open the gallery entry");
            }
            try {
                output.write(bytes);
                output.flush();
            } finally {
                output.close();
            }
        } catch (IOException error) {
            // Never leave a half-written pending row behind.
            try {
                resolver.delete(item, null, null);
            } catch (Exception ignored) {
                // Best effort cleanup only.
            }
            throw error;
        }

        // Clear IS_PENDING so Photos/Gallery can index the finished file.
        ContentValues finished = new ContentValues();
        finished.put(MediaStore.Images.Media.IS_PENDING, 0);
        resolver.update(item, finished, null, null);
        return item;
    }

    /** Android 7–9 — public Pictures write after WRITE_EXTERNAL_STORAGE, then scan. */
    private Uri writeToLegacyPictures(byte[] bytes, String mime, String fileName) throws IOException {
        File directory = new File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
            GALLERY_FOLDER
        );
        if (!directory.exists() && !directory.mkdirs() && !directory.isDirectory()) {
            throw new IOException("Android could not open the Pictures folder");
        }
        File target = uniqueFile(directory, fileName);
        FileOutputStream output = new FileOutputStream(target);
        try {
            output.write(bytes);
            output.flush();
        } finally {
            output.close();
        }
        // Media scan so the gallery indexes the new file immediately.
        MediaScannerConnection.scanFile(
            getContext(),
            new String[] { target.getAbsolutePath() },
            new String[] { mime },
            null
        );
        return Uri.fromFile(target);
    }

    private static File uniqueFile(File directory, String fileName) {
        File candidate = new File(directory, fileName);
        if (!candidate.exists()) {
            return candidate;
        }
        int dot = fileName.lastIndexOf('.');
        String stem = dot > 0 ? fileName.substring(0, dot) : fileName;
        String suffix = dot > 0 ? fileName.substring(dot) : "";
        for (int attempt = 1; attempt < 100; attempt++) {
            candidate = new File(directory, stem + "_" + attempt + suffix);
            if (!candidate.exists()) {
                return candidate;
            }
        }
        return new File(directory, stem + "_" + System.currentTimeMillis() + suffix);
    }
}
