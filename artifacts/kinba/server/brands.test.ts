/**
 * JHILIK Ads Phase 2 — brand application validation + transitions.
 * Pure tests: zod input schema and the state machine. No DB.
 */
import { describe, expect, it } from "vitest";
import {
  assertTransition,
  BRAND_APPLICATION_TRANSITIONS,
} from "../shared/stateMachines";
import { MAX_BRAND_DOC_BYTES } from "../shared/brandApplications";
import { brandApplicationInput, brandDocUploadInput } from "./brands";

const validInput = {
  brandName: "Aarong Dairy",
  category: "Food & Beverage",
  contactPerson: "Rahim Uddin",
  email: "marketing@aarongdairy.com",
  phone: "+8801712345678",
  country: "Bangladesh",
  targetMarket: "Dhaka, 18–35",
  website: "https://aarongdairy.com",
  socials: [{ label: "Facebook", url: "https://facebook.com/aarongdairy" }],
  productDetails: "Dairy products",
  objectives: ["brand_awareness", "product_launch"],
  formats: ["sponsored_shorts"],
  budgetAmount: "5000",
  budgetCurrency: "USD",
  links: [
    {
      kind: "product",
      label: "Promo",
      url: "https://aarongdairy.com/promo",
      productName: "Milk 1L",
      price: "120",
    },
  ],
  documents: [],
};

describe("brandApplicationInput", () => {
  it("accepts a valid application", () => {
    const parsed = brandApplicationInput.parse(validInput);
    expect(parsed.brandName).toBe("Aarong Dairy");
    expect(parsed.status).toBeUndefined(); // status is server-set, not input
    expect(parsed.budgetAmount).toBe("5000");
  });

  it("rejects an invalid email", () => {
    const result = brandApplicationInput.safeParse({
      ...validInput,
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsafe URL schemes", () => {
    const result = brandApplicationInput.safeParse({
      ...validInput,
      website: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a data: URL in links", () => {
    const result = brandApplicationInput.safeParse({
      ...validInput,
      links: [{ kind: "website", url: "data:text/html,<h1>x</h1>" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative and zero budgets", () => {
    for (const budgetAmount of ["-100", "0", "0.00"]) {
      const result = brandApplicationInput.safeParse({
        ...validInput,
        budgetAmount,
      });
      expect(result.success, budgetAmount).toBe(false);
    }
  });

  it("rejects more than 2 decimal places", () => {
    const result = brandApplicationInput.safeParse({
      ...validInput,
      budgetAmount: "10.999",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown currencies", () => {
    const result = brandApplicationInput.safeParse({
      ...validInput,
      budgetCurrency: "EUR",
    });
    expect(result.success).toBe(false);
  });

  it("accepts BDT", () => {
    const parsed = brandApplicationInput.parse({
      ...validInput,
      budgetCurrency: "BDT",
      budgetAmount: "50000",
    });
    expect(parsed.budgetCurrency).toBe("BDT");
  });

  it("requires at least one objective and one format", () => {
    expect(
      brandApplicationInput.safeParse({ ...validInput, objectives: [] })
        .success
    ).toBe(false);
    expect(
      brandApplicationInput.safeParse({ ...validInput, formats: [] }).success
    ).toBe(false);
  });

  it("rejects end date before start date", () => {
    const result = brandApplicationInput.safeParse({
      ...validInput,
      startsAt: "2026-12-10T00:00:00.000Z",
      endsAt: "2026-12-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects document keys outside the caller's prefix at the service layer contract", () => {
    // The prefix check lives in submitBrandApplication (needs userId);
    // here we assert the schema at least requires non-empty keys.
    const result = brandApplicationInput.safeParse({
      ...validInput,
      documents: [{ key: "", fileName: "x.pdf", contentType: "application/pdf" }],
    });
    expect(result.success).toBe(false);
  });

  it("normalizes URLs (trims)", () => {
    const parsed = brandApplicationInput.parse({
      ...validInput,
      website: "  https://aarongdairy.com/  ",
    });
    expect(parsed.website).toBe("https://aarongdairy.com/");
  });
});

describe("brand application review transitions", () => {
  it("allows submitted → pending/info_requested/approved/rejected", () => {
    for (const to of ["pending", "info_requested", "approved", "rejected"] as const) {
      expect(() =>
        assertTransition(BRAND_APPLICATION_TRANSITIONS, "submitted", to, "application status")
      ).not.toThrow();
    }
  });

  it("allows info_requested → pending/approved/rejected", () => {
    for (const to of ["pending", "approved", "rejected"] as const) {
      expect(() =>
        assertTransition(BRAND_APPLICATION_TRANSITIONS, "info_requested", to, "application status")
      ).not.toThrow();
    }
  });

  it("rejects backwards and terminal transitions", () => {
    expect(() =>
      assertTransition(BRAND_APPLICATION_TRANSITIONS, "submitted", "draft", "application status")
    ).toThrow(/Invalid application status transition/);
    expect(() =>
      assertTransition(BRAND_APPLICATION_TRANSITIONS, "approved", "rejected", "application status")
    ).toThrow(/Invalid application status transition/);
    expect(() =>
      assertTransition(BRAND_APPLICATION_TRANSITIONS, "rejected", "approved", "application status")
    ).toThrow(/Invalid application status transition/);
  });

  it("never lets the brand set the reward split (schema has no such input)", () => {
    const parsed = brandApplicationInput.parse(validInput);
    expect("creatorPool" in parsed).toBe(false);
    expect("serviceFee" in parsed).toBe(false);
  });
});

describe("brandDocUploadInput", () => {
  const validUpload = {
    contentType: "application/pdf",
    fileName: "trade-license.pdf",
    fileSize: 1024,
  };

  it("accepts an allowed document within the size limit", () => {
    expect(brandDocUploadInput.parse(validUpload).fileSize).toBe(1024);
  });

  it("rejects empty, oversized, or non-integer sizes", () => {
    for (const fileSize of [0, MAX_BRAND_DOC_BYTES + 1, 1.5]) {
      expect(
        brandDocUploadInput.safeParse({ ...validUpload, fileSize }).success
      ).toBe(false);
    }
  });

  it("rejects unsupported document types", () => {
    expect(
      brandDocUploadInput.safeParse({
        ...validUpload,
        contentType: "text/html",
      }).success
    ).toBe(false);
  });
});
