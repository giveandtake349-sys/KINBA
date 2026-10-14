/**
 * JHILIK Brand Advertising — Phase 2: brand applications.
 *
 * End-to-end brand application flow:
 *   brand: submitApplication (protected) → myApplications (protected, own only)
 *   admin: list / detail / review (adminProcedure), private doc URLs (admin only)
 *
 * Visibility rules (enforced here, not just in UI):
 *   - Public sees nothing about applications or budgets.
 *   - A brand sees ONLY their own applications (ownership checked).
 *   - Admins see everything, including contact PII and the budget split.
 *   - The creator reward pool / service fee split is NEVER set by the brand
 *     (columns exist on brand_applications but submitApplication leaves them null;
 *     only a later admin step sets them).
 *
 * Money: budgetAmount is a decimal string mapped to numeric(12,2); currency is
 * an explicit USD|BDT column. No floats, no FX conversion in Phase 2.
 *
 * Documents: verification files upload straight from the browser to R2 under
 * a private `brand-docs/{userId}/` prefix via signed PUT URLs. Only the R2 key
 * is stored in the DB; admins fetch short-lived signed GET URLs. There is NO
 * public serving route for brand documents.
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  brandApplications,
  brandLinks,
  brands,
  campaignAuditLog,
} from "../drizzle/schema";
import {
  assertTransition,
  BRAND_APPLICATION_STATUSES,
  BRAND_APPLICATION_TRANSITIONS,
  type BrandApplicationStatus,
} from "../shared/stateMachines";
import { getDb } from "./db";
import { validateRoomLink } from "./hypeRooms";
import { insertNotification, NOTIFICATION_TYPES } from "./notifications";
import { storageCreateUploadUrl, storageGetSignedUrl } from "./storage";

/* ------------------------------------------------------------------ */
/* Input validation                                                    */
/* ------------------------------------------------------------------ */

export const APPLICATION_OBJECTIVES = [
  "brand_awareness",
  "audience_reach",
  "product_launch",
  "website_traffic",
  "product_discovery",
  "leads",
  "sales",
  "creator_content",
  "community_engagement",
  "other",
] as const;

export const APPLICATION_FORMATS = [
  "sponsored_feed",
  "sponsored_video",
  "sponsored_shorts",
  "creator_led",
  "product_demo",
  "other",
] as const;

export const APPLICATION_CURRENCIES = ["USD", "BDT"] as const;

export const APPLICATION_LINK_KINDS = [
  "website",
  "landing",
  "social",
  "product",
] as const;

/** Positive decimal with up to 2 fraction digits — maps to numeric(12,2). */
const moneyString = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, `${label} must be a positive amount.`)
    .refine(
      value => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 && n <= 9999999999.99;
      },
      { message: `${label} is out of range.` }
    );

/**
 * Required external URL. Reuses the verified room-link validator:
 * http/https only, host required, unsafe schemes rejected.
 */
const externalUrl = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(2048, `${label} is too long.`)
    .transform((value, ctx) => {
      try {
        const normalized = validateRoomLink(value);
        if (!normalized) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${label} is required.`,
          });
          return z.NEVER;
        }
        return normalized;
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            error instanceof Error ? error.message : `${label} is invalid.`,
        });
        return z.NEVER;
      }
    });

/** Optional external URL — empty string becomes null. */
const optionalExternalUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(2048, `${label} is too long.`)
    .transform((value, ctx) => {
      if (!value) return null;
      try {
        return validateRoomLink(value);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            error instanceof Error ? error.message : `${label} is invalid.`,
        });
        return z.NEVER;
      }
    });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform(value => (value ? value : null));

export const brandApplicationInput = z
  .object({
    brandName: z.string().trim().min(1, "Brand name is required.").max(160),
    category: z.string().trim().max(80).optional().default(""),
    contactPerson: z.string().trim().max(120).optional().default(""),
    email: z
      .string()
      .trim()
      .max(320)
      .email("Enter a valid business email."),
    phone: z
      .string()
      .trim()
      .max(32)
      .regex(
        /^[+\d][\d\s\-().]{1,31}$/,
        "Enter a valid phone or WhatsApp number."
      )
      .optional()
      .or(z.literal("")),
    country: z.string().trim().max(64).optional().default(""),
    targetMarket: z.string().trim().max(64).optional().default(""),
    website: optionalExternalUrl("Website"),
    socials: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(40),
          url: externalUrl("Social link"),
        })
      )
      .max(10)
      .default([]),
    productDetails: z.string().trim().max(5000).optional().default(""),
    objectives: z
      .array(z.enum(APPLICATION_OBJECTIVES))
      .min(1, "Pick at least one objective.")
      .max(10),
    formats: z
      .array(z.enum(APPLICATION_FORMATS))
      .min(1, "Pick at least one format.")
      .max(6),
    budgetAmount: moneyString("Budget"),
    budgetCurrency: z.enum(APPLICATION_CURRENCIES),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    audience: z
      .object({
        country: z.string().trim().max(64).optional().default(""),
        language: z.string().trim().max(64).optional().default(""),
        interests: z.array(z.string().trim().max(60)).max(20).default([]),
      })
      .optional()
      .default({ country: "" as string, language: "" as string, interests: [] as string[] }),
    links: z
      .array(
        z.object({
          kind: z.enum(APPLICATION_LINK_KINDS).default("website"),
          label: z.string().trim().max(160).optional().default(""),
          url: externalUrl("Link"),
          productName: z.string().trim().max(200).optional().default(""),
          price: moneyString("Price").optional().or(z.literal("")),
          priceCurrency: z.enum(APPLICATION_CURRENCIES).optional(),
          imageUrl: optionalExternalUrl("Product image").optional(),
        })
      )
      .max(10)
      .default([]),
    documents: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(512),
          fileName: z.string().trim().min(1).max(160),
          contentType: z.string().trim().min(1).max(120),
        })
      )
      .max(5)
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (
      value.startsAt &&
      value.endsAt &&
      new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "End date must be after the start date.",
      });
    }
  });

export type BrandApplicationInput = z.output<typeof brandApplicationInput>;

export const adminApplicationListInput = z.object({
  status: z.enum(BRAND_APPLICATION_STATUSES).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

export const reviewApplicationInput = z.object({
  id: z.number().int().positive(),
  toStatus: z.enum(["info_requested", "approved", "rejected"] as const),
  note: z.string().trim().max(2000).optional().default(""),
});

export const brandDocUploadInput = z.object({
  contentType: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1).max(160),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const orNull = (value: string | null | undefined): string | null =>
  value && value.length > 0 ? value : null;

const DOC_KEY_PREFIX = "brand-docs/";

const DOC_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/* ------------------------------------------------------------------ */
/* Brand procedures                                                    */
/* ------------------------------------------------------------------ */

/**
 * Submit a brand application. Creates/refreshes the caller's brand row,
 * inserts the application (status=submitted) + links, and writes an audit
 * entry — all in one transaction. The reward-pool/fee split stays null:
 * only admins set it later.
 */
export async function submitBrandApplication(
  userId: number,
  input: BrandApplicationInput
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Document keys must live under this user's private prefix — a brand can
  // never reference another user's uploads.
  for (const doc of input.documents) {
    if (!doc.key.startsWith(`${DOC_KEY_PREFIX}${userId}/`)) {
      throw new Error("Invalid document reference.");
    }
  }

  const now = new Date();
  return db.transaction(async tx => {
    const [existing] = await tx
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.userId, userId))
      .limit(1);

    let brandId: number;
    const brandValues = {
      userId,
      name: input.brandName,
      category: orNull(input.category),
      contactPerson: orNull(input.contactPerson),
      email: input.email,
      phone: orNull(input.phone),
      country: orNull(input.country),
      website: input.website,
      socials:
        input.socials.length > 0
          ? input.socials.map(s => ({ label: s.label, url: s.url }))
          : null,
      productDetails: orNull(input.productDetails),
      updatedAt: now,
    };
    if (existing) {
      await tx.update(brands).set(brandValues).where(eq(brands.id, existing.id));
      brandId = existing.id;
    } else {
      const [created] = await tx
        .insert(brands)
        .values(brandValues)
        .returning({ id: brands.id });
      if (!created) throw new Error("Could not create brand profile.");
      brandId = created.id;
    }

    const [application] = await tx
      .insert(brandApplications)
      .values({
        userId,
        brandName: input.brandName,
        category: orNull(input.category),
        contactPerson: orNull(input.contactPerson),
        email: input.email,
        phone: orNull(input.phone),
        country: orNull(input.country),
        targetMarket: orNull(input.targetMarket),
        website: input.website,
        socials:
          input.socials.length > 0
            ? input.socials.map(s => ({ label: s.label, url: s.url }))
            : null,
        productDetails: orNull(input.productDetails),
        objectives: [...input.objectives],
        formats: [...input.formats],
        budgetAmount: input.budgetAmount,
        budgetCurrency: input.budgetCurrency,
        serviceFee: null,
        creatorPool: null,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        audience: {
          country: input.audience.country || null,
          language: input.audience.language || null,
          interests: input.audience.interests,
        },
        documents:
          input.documents.length > 0
            ? input.documents.map(d => ({
                key: d.key,
                fileName: d.fileName,
                contentType: d.contentType,
                uploadedAt: now.toISOString(),
              }))
            : null,
        status: "submitted",
      })
      .returning({ id: brandApplications.id });
    if (!application) throw new Error("Could not save the application.");

    if (input.links.length > 0) {
      await tx.insert(brandLinks).values(
        input.links.map(link => ({
          applicationId: application.id,
          kind: link.kind,
          label: orNull(link.label),
          url: link.url,
          productName: orNull(link.productName),
          price: link.price ? link.price : null,
          imageUrl: link.imageUrl,
        }))
      );
    }

    await tx.insert(campaignAuditLog).values({
      applicationId: application.id,
      actorId: userId,
      action: "application.submitted",
      details: {
        brandName: input.brandName,
        budgetAmount: input.budgetAmount,
        budgetCurrency: input.budgetCurrency,
      },
    });

    return { applicationId: application.id, brandId };
  });
}

/**
 * The caller's own applications — ownership enforced by userId.
 * Contact PII is the owner's own; the list stays minimal anyway.
 */
export async function listMyBrandApplications(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select({
      id: brandApplications.id,
      brandName: brandApplications.brandName,
      category: brandApplications.category,
      status: brandApplications.status,
      budgetAmount: brandApplications.budgetAmount,
      budgetCurrency: brandApplications.budgetCurrency,
      createdAt: brandApplications.createdAt,
      reviewedAt: brandApplications.reviewedAt,
    })
    .from(brandApplications)
    .where(eq(brandApplications.userId, userId))
    .orderBy(desc(brandApplications.createdAt))
    .limit(50);
}

/* ------------------------------------------------------------------ */
/* Admin procedures                                                    */
/* ------------------------------------------------------------------ */

/**
 * Paginated application list for admins. Deliberately excludes contact PII
 * (email/phone/contact person) — open the detail view for verification.
 */
export async function listBrandApplicationsForAdmin(input: {
  status?: BrandApplicationStatus;
  limit: number;
  offset: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const conditions =
    input.status != null
      ? eq(brandApplications.status, input.status)
      : undefined;
  const rows = await db
    .select({
      id: brandApplications.id,
      userId: brandApplications.userId,
      brandName: brandApplications.brandName,
      category: brandApplications.category,
      country: brandApplications.country,
      budgetAmount: brandApplications.budgetAmount,
      budgetCurrency: brandApplications.budgetCurrency,
      status: brandApplications.status,
      createdAt: brandApplications.createdAt,
    })
    .from(brandApplications)
    .where(conditions)
    .orderBy(desc(brandApplications.createdAt))
    .limit(input.limit)
    .offset(input.offset);
  return { items: rows };
}

/** Full application detail for admins — includes contact PII and doc links. */
export async function getBrandApplicationForAdmin(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [application] = await db
    .select()
    .from(brandApplications)
    .where(eq(brandApplications.id, id))
    .limit(1);
  if (!application) throw new Error("Application not found.");

  const links = await db
    .select()
    .from(brandLinks)
    .where(eq(brandLinks.applicationId, id));

  const audit = await db
    .select()
    .from(campaignAuditLog)
    .where(eq(campaignAuditLog.applicationId, id))
    .orderBy(desc(campaignAuditLog.createdAt))
    .limit(25);

  // Resolve private document keys to short-lived signed URLs at read time.
  const rawDocs = (application.documents ?? []) as Array<{
    key: string;
    fileName: string;
    contentType: string;
    uploadedAt?: string;
  }>;
  const documents = await Promise.all(
    rawDocs
      .filter(doc => typeof doc.key === "string" && doc.key.startsWith(DOC_KEY_PREFIX))
      .map(async doc => ({
        fileName: doc.fileName,
        contentType: doc.contentType,
        uploadedAt: doc.uploadedAt ?? null,
        viewUrl: await storageGetSignedUrl(doc.key),
      }))
  );

  return { application, links, documents, audit };
}

/**
 * Admin review transition. The state machine is the authority — invalid
 * transitions throw before any write. Writes the audit entry and notifies
 * the applicant on every transition.
 */
export async function reviewBrandApplication(
  adminId: number,
  id: number,
  toStatus: "info_requested" | "approved" | "rejected",
  note: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [application] = await db
    .select()
    .from(brandApplications)
    .where(eq(brandApplications.id, id))
    .limit(1);
  if (!application) throw new Error("Application not found.");

  assertTransition(
    BRAND_APPLICATION_TRANSITIONS,
    application.status as BrandApplicationStatus,
    toStatus,
    "application status"
  );

  const now = new Date();
  await db.transaction(async tx => {
    await tx
      .update(brandApplications)
      .set({
        status: toStatus,
        reviewedBy: adminId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(brandApplications.id, id),
          eq(brandApplications.status, application.status)
        )
      );
    await tx.insert(campaignAuditLog).values({
      applicationId: id,
      actorId: adminId,
      action: `application.${toStatus}`,
      details: {
        from: application.status,
        ...(note ? { note: note.slice(0, 2000) } : {}),
      },
    });
  });

  const statusCopy: Record<typeof toStatus, string> = {
    info_requested: "needs a little more information",
    approved: "has been approved",
    rejected: "wasn't approved this time",
  };
  await insertNotification({
    userId: application.userId,
    type: NOTIFICATION_TYPES.applicationStatus,
    title: "Brand application update",
    body:
      `Your application for ${application.brandName} ${statusCopy[toStatus]}.` +
      (note ? ` Note from our team: ${note.slice(0, 180)}` : ""),
    entityType: "brand_application",
    entityId: id,
    link: "/advertise/apply",
  });

  return { id, status: toStatus };
}

/* ------------------------------------------------------------------ */
/* Private document upload                                             */
/* ------------------------------------------------------------------ */

/**
 * Signed browser→R2 PUT URL for a verification document. The key is minted
 * server-side under the caller's private prefix; the client never chooses it.
 */
export async function createBrandDocUploadUrl(
  userId: number,
  contentType: string,
  fileName: string
) {
  if (!DOC_CONTENT_TYPES.has(contentType)) {
    throw new Error(
      "Only PDF, PNG, JPG, or WEBP documents are accepted."
    );
  }
  const clean =
    fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "document";
  const relKey = `${DOC_KEY_PREFIX}${userId}/${clean}`;
  const { key, url } = await storageCreateUploadUrl(relKey, contentType);
  return { key, uploadUrl: url };
}

/**
 * Admin-only signed GET URL for a stored document. The key must live under
 * the private prefix — never sign arbitrary keys.
 */
export async function getBrandDocViewUrl(key: string) {
  if (!key.startsWith(DOC_KEY_PREFIX)) {
    throw new Error("Invalid document reference.");
  }
  return { viewUrl: await storageGetSignedUrl(key) };
}
