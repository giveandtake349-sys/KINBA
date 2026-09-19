import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { uploadImage } from "@/lib/mediaUpload";
import { apiUrl } from "@/lib/api";
import { supabase } from "@/lib/supabase";

type Area = { width: number; height: number; x: number; y: number };

async function getCroppedBlob(
  imageSrc: string,
  cropX: number,
  cropY: number,
  cropSize: number,
  naturalWidth: number,
  naturalHeight: number,
  displayWidth: number,
  displayHeight: number,
  outputSize = 512
): Promise<Blob> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to load image for cropping."));
    image.src = imageSrc;
  });

  const scaleX = naturalWidth / displayWidth;
  const scaleY = naturalHeight / displayHeight;

  const sx = cropX * scaleX;
  const sy = cropY * scaleY;
  const sw = cropSize * scaleX;
  const sh = cropSize * scaleY;

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available for cropping.");

  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, outputSize, outputSize);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to generate cropped image."));
      },
      "image/jpeg",
      0.92
    );
  });
}

export default function AvatarCropModal({
  file,
  open,
  onClose,
  onSaved,
}: {
  file: File | null;
  open: boolean;
  onClose: () => void;
  onSaved: (url: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [shareAsPost, setShareAsPost] = useState(false);
  const [caption, setCaption] = useState("");
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const imageSrc = (() => {
    if (!file) return null;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(file);
    return objectUrlRef.current;
  })();

  useEffect(() => {
    if (!open) {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setShareAsPost(false);
      setCaption("");
      setImgNatural(null);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const displaySize = (() => {
    const container = containerRef.current;
    if (!container) return 280;
    return Math.min(container.clientWidth, container.clientHeight, 280);
  })();

  const cropSize = displaySize / zoom;
  const imgDisplayW = imgNatural ? (imgNatural.w / imgNatural.h) * displaySize : displaySize;
  const imgDisplayH = displaySize;

  const maxOffsetX = Math.max(0, (imgDisplayW - cropSize) / 2);
  const maxOffsetY = Math.max(0, (imgDisplayH - cropSize) / 2);

  const clampedOffset = {
    x: Math.max(-maxOffsetX, Math.min(maxOffsetX, offset.x)),
    y: Math.max(-maxOffsetY, Math.min(maxOffsetY, offset.y)),
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [offset]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setOffset({ x: dragStart.current.ox + dx, y: dragStart.current.oy + dy });
  }, [dragging]);

  const onPointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleSave = async () => {
    if (!imageSrc || !imgNatural || !file) return;
    setProcessing(true);
    try {
      const img = imgRef.current;
      if (!img) throw new Error("Image not loaded.");

      const srcCropX = (imgDisplayW / 2 - cropSize / 2 - clampedOffset.x) * (imgNatural.w / imgDisplayW);
      const srcCropY = (imgDisplayH / 2 - cropSize / 2 - clampedOffset.y) * (imgNatural.h / imgDisplayH);
      const srcCropSize = cropSize * (imgNatural.w / imgDisplayW);

      const blob = await getCroppedBlob(
        imageSrc,
        srcCropX,
        srcCropY,
        srcCropSize,
        imgNatural.w,
        imgNatural.h,
        imgDisplayW,
        imgDisplayH
      );
      const croppedFile = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
        type: "image/jpeg",
      });
      const avatarUrl = await uploadImage("avatar", croppedFile);
      onSaved(avatarUrl);

      if (shareAsPost) {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (token && avatarUrl) {
          const postImg = new Image();
          postImg.crossOrigin = "anonymous";
          await new Promise<void>((resolve) => {
            postImg.onload = () => resolve();
            postImg.onerror = () => resolve();
            postImg.src = avatarUrl;
          });
          const response = await fetch(apiUrl("/api/photos/create"), {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              title: caption.trim() || "New profile photo",
              description: caption.trim(),
              imageUrl: avatarUrl,
              width: postImg.naturalWidth || 512,
              height: postImg.naturalHeight || 512,
            }),
          });
          if (response.ok) {
            toast.success("Profile photo shared as a new post.");
          } else {
            toast.error("Photo saved but could not be shared as a post.");
          }
        }
      }

      toast.success("Profile photo updated.");
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save cropped photo."
      );
    } finally {
      setProcessing(false);
    }
  };

  if (!open || !file || !imageSrc) return null;

  return (
    <div className="pr-modal-overlay" role="dialog" aria-modal="true" aria-label="Crop profile photo">
      <div className="pr-modal pr-crop-modal">
        <div className="pr-modal-header">
          <h2>Crop Photo</h2>
          <button type="button" className="pr-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div
          className="pr-crop-viewport"
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ touchAction: "none" }}
        >
          <div className="pr-crop-image-wrapper">
            <img
              ref={imgRef}
              src={imageSrc}
              alt="Crop preview"
              className="pr-crop-image"
              draggable={false}
              onLoad={e => {
                const el = e.currentTarget;
                setImgNatural({ w: el.naturalWidth, h: el.naturalHeight });
              }}
              style={{
                width: imgDisplayW,
                height: imgDisplayH,
                transform: `translate(${clampedOffset.x}px, ${clampedOffset.y}px)`,
              }}
            />
          </div>
          <div
            className="pr-crop-mask"
            style={{
              width: cropSize,
              height: cropSize,
            }}
          />
          <div
            className="pr-crop-frame"
            style={{
              width: cropSize,
              height: cropSize,
            }}
          />
        </div>
        <div className="pr-crop-controls">
          <label className="pr-crop-zoom-label">
            <span>Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              aria-label="Zoom level"
            />
          </label>
        </div>
        <div className="pr-crop-share-option">
          <label className="pr-crop-checkbox">
            <input
              type="checkbox"
              checked={shareAsPost}
              onChange={e => setShareAsPost(e.target.checked)}
            />
            <span>Also share as a post</span>
          </label>
          {shareAsPost && (
            <input
              className="pr-input pr-crop-caption"
              value={caption}
              onChange={e => setCaption(e.target.value)}
              maxLength={200}
              placeholder="Add a caption…"
              aria-label="Post caption"
            />
          )}
        </div>
        <div className="pr-modal-actions">
          <button type="button" className="pr-btn pr-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="pr-btn pr-btn--primary"
            onClick={() => void handleSave()}
            disabled={processing}
          >
            {processing ? (
              <>
                <Loader2 size={14} className="pr-spin" /> Saving…
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
