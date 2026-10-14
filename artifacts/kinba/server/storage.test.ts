import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function configureR2(privateBucket: string) {
  vi.stubEnv("R2_ENDPOINT", "https://r2.example.test");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret-key");
  vi.stubEnv("R2_BUCKET_NAME", "kinba-media");
  vi.stubEnv("R2_PRIVATE_BUCKET_NAME", privateBucket);
}

async function loadStorage() {
  vi.resetModules();
  return import("./storage");
}

describe("private brand document storage", () => {
  it("fails closed when the private bucket is not configured", async () => {
    configureR2("");
    const storage = await loadStorage();

    await expect(
      storage.storageCreatePrivateUploadUrl(
        "brand-docs/1/license.pdf",
        "application/pdf",
        1024
      )
    ).rejects.toThrow(/R2_PRIVATE_BUCKET_NAME/);
  });

  it("rejects reusing the public media bucket for private documents", async () => {
    configureR2("kinba-media");
    const storage = await loadStorage();

    await expect(
      storage.storageCreatePrivateUploadUrl(
        "brand-docs/1/license.pdf",
        "application/pdf",
        1024
      )
    ).rejects.toThrow(/different from R2_BUCKET_NAME/);
  });

  it("signs the upload for the private bucket and exact byte length", async () => {
    configureR2("kinba-brand-documents");
    const storage = await loadStorage();
    const upload = await storage.storageCreatePrivateUploadUrl(
      "brand-docs/1/license.pdf",
      "application/pdf",
      1024
    );
    const url = new URL(upload.url);

    expect(url.pathname).toContain("/kinba-brand-documents/");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-length"
    );
    expect(upload.key).toMatch(/^brand-docs\/1\/license_[a-f0-9]{8}\.pdf$/);
  });

  it("signs admin downloads as private no-store attachments", async () => {
    configureR2("kinba-brand-documents");
    const storage = await loadStorage();
    const url = new URL(
      await storage.storageGetPrivateSignedUrl("brand-docs/1/license.pdf")
    );

    expect(url.pathname).toContain("/kinba-brand-documents/");
    expect(url.searchParams.get("response-content-disposition")).toBe(
      "attachment"
    );
    expect(url.searchParams.get("response-cache-control")).toContain(
      "no-store"
    );
  });
});
