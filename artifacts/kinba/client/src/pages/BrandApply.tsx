import { useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  FileUp,
  Loader2,
  Lock,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  BRAND_DOC_CONTENT_TYPES,
  MAX_BRAND_DOC_BYTES,
  MAX_BRAND_DOC_SIZE_LABEL,
} from "@shared/brandApplications";
import "./advertise.css";

const OBJECTIVE_IDS = [
  "brand_awareness",
  "audience_reach",
  "product_launch",
  "website_traffic",
  "product_discovery",
  "leads",
  "sales",
  "creator_content",
  "community_engagement",
] as const;
type ObjectiveId = (typeof OBJECTIVE_IDS)[number];

const FORMAT_IDS = [
  "sponsored_feed",
  "sponsored_video",
  "sponsored_shorts",
  "creator_led",
  "product_demo",
] as const;
type FormatId = (typeof FORMAT_IDS)[number];

const OBJECTIVES: { id: ObjectiveId; label: string }[] = [
  { id: "brand_awareness", label: "Brand awareness" },
  { id: "audience_reach", label: "Audience reach" },
  { id: "product_launch", label: "Product launch" },
  { id: "website_traffic", label: "Website traffic" },
  { id: "product_discovery", label: "Product discovery" },
  { id: "leads", label: "Leads / enquiries" },
  { id: "sales", label: "Sales / conversions" },
  { id: "creator_content", label: "Creator content" },
  { id: "community_engagement", label: "Community engagement" },
];

const FORMATS: { id: FormatId; label: string }[] = [
  { id: "sponsored_feed", label: "Sponsored Feed" },
  { id: "sponsored_video", label: "Sponsored Video" },
  { id: "sponsored_shorts", label: "Sponsored Shorts" },
  { id: "creator_led", label: "Creator-led" },
  { id: "product_demo", label: "Product demo" },
];

const isSupportedDocType = (contentType: string) =>
  (BRAND_DOC_CONTENT_TYPES as readonly string[]).includes(contentType);

type LinkDraft = {
  kind: "website" | "landing" | "social" | "product";
  label: string;
  url: string;
  productName: string;
  price: string;
};

type DocDraft = { key: string; fileName: string; contentType: string };

const EMPTY_LINK: LinkDraft = {
  kind: "website",
  label: "",
  url: "",
  productName: "",
  price: "",
};

function Field({
  label,
  required,
  error,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="adv-field">
      <label>
        {label}
        {required ? <span className="req" aria-hidden="true">*</span> : null}
      </label>
      {children}
      {hint ? <div className="adv-hint">{hint}</div> : null}
      {error ? (
        <div className="adv-field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Brand application form. Authenticated brands only — the server enforces
 * ownership; a brand can only ever see and submit their own applications.
 */
export default function BrandApply() {
  const [, navigate] = useLocation();
  const auth = useAuth();
  const utils = trpc.useUtils();

  const [brandName, setBrandName] = useState("");
  const [category, setCategory] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [targetMarket, setTargetMarket] = useState("");
  const [objectives, setObjectives] = useState<ObjectiveId[]>([]);
  const [formats, setFormats] = useState<FormatId[]>([]);
  const [currency, setCurrency] = useState<"USD" | "BDT">("USD");
  const [budget, setBudget] = useState("");
  const [website, setWebsite] = useState("");
  const [productDetails, setProductDetails] = useState("");
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [docs, setDocs] = useState<DocDraft[]>([]);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [formError, setFormError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const myApps = trpc.brands.myApplications.useQuery(undefined, {
    enabled: auth.isAuthenticated,
  });
  const submit = trpc.brands.submitApplication.useMutation();
  const getUploadUrl = trpc.brands.docUploadUrl.useMutation();

  const toggle = <T extends string>(
    list: T[],
    id: T,
    set: (v: T[]) => void
  ) => set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const filesToUpload = Array.from(files);
    if (
      filesToUpload.some(
        file => !isSupportedDocType(file.type)
      )
    ) {
      toast.error("Only PDF, PNG, JPG, or WEBP documents are accepted.");
      return;
    }
    if (
      filesToUpload.some(
        file => file.size < 1 || file.size > MAX_BRAND_DOC_BYTES
      )
    ) {
      toast.error(
        `Each document must be between 1 byte and ${MAX_BRAND_DOC_SIZE_LABEL}.`
      );
      return;
    }
    if (docs.length + filesToUpload.length > 5) {
      toast.error("You can attach up to 5 documents.");
      return;
    }
    setUploading(true);
    try {
      for (const file of filesToUpload) {
        const { key, uploadUrl } = await getUploadUrl.mutateAsync({
          contentType: file.type as (typeof BRAND_DOC_CONTENT_TYPES)[number],
          fileName: file.name,
          fileSize: file.size,
        });
        const res = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!res.ok) throw new Error("Upload failed. Please try again.");
        setDocs(prev => [
          ...prev,
          { key, fileName: file.name, contentType: file.type },
        ]);
      }
      toast.success("Document uploaded.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Document upload failed."
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const validate = (): string => {
    if (!brandName.trim()) return "Brand name is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return "Enter a valid business email.";
    if (objectives.length === 0) return "Pick at least one objective.";
    if (formats.length === 0) return "Pick at least one campaign format.";
    const amount = Number(budget.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0)
      return "Enter a valid campaign budget.";
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt))
      return "End date must be after the start date.";
    for (const link of links) {
      if (!link.url.trim()) return "Every added link needs a URL.";
    }
    return "";
  };

  const handleSubmit = async () => {
    setFormError("");
    const problem = validate();
    if (problem) {
      setFormError(problem);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    try {
      await submit.mutateAsync({
        brandName: brandName.trim(),
        category: category.trim(),
        contactPerson: contactPerson.trim(),
        email: email.trim(),
        phone: phone.trim(),
        country: country.trim(),
        targetMarket: targetMarket.trim(),
        website: website.trim(),
        socials: [],
        productDetails: productDetails.trim(),
        objectives,
        formats,
        budgetAmount: budget.replace(/,/g, ""),
        budgetCurrency: currency,
        startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
        links: links.map(l => ({
          kind: l.kind,
          label: l.label.trim(),
          url: l.url.trim(),
          productName: l.productName.trim(),
          price: l.price.replace(/,/g, "").trim(),
        })),
        documents: docs,
      });
      await utils.brands.myApplications.invalidate();
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Submission failed."
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  if (!auth.isAuthenticated) {
    return (
      <main className="adv-page">
        <div className="adv-topbar">
          <button
            type="button"
            className="adv-back"
            onClick={() => navigate("/advertise")}
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <span className="adv-topbar-title">Brand Application</span>
          <span style={{ width: 40 }} aria-hidden="true" />
        </div>
        <section className="adv-card" style={{ textAlign: "center" }}>
          <h2>Sign in to apply</h2>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
            You need a JHILIK account so we can tie the application to you —
            and so only you can see it.
          </p>
          <button
            type="button"
            className="adv-cta full"
            onClick={() => navigate("/advertise")}
          >
            Back to Advertise
          </button>
        </section>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="adv-page">
        <div className="adv-topbar">
          <button
            type="button"
            className="adv-back"
            onClick={() => navigate("/")}
            aria-label="Back to home"
          >
            <ArrowLeft size={20} />
          </button>
          <span className="adv-topbar-title">Brand Application</span>
          <span style={{ width: 40 }} aria-hidden="true" />
        </div>
        <section className="adv-card">
          <div className="adv-success">
            <span className="adv-success-icon" aria-hidden="true">
              <CheckCircle2 size={32} />
            </span>
            <h2>Application received</h2>
            <p>
              Thanks for applying. Our team will review your submission and
              contact you about possible next steps. This application does not
              guarantee campaign availability or reach.
            </p>
            <button
              type="button"
              className="adv-cta"
              onClick={() => navigate("/")}
            >
              Back to Home
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="adv-page">
      <div className="adv-topbar">
        <button
          type="button"
          className="adv-back"
          onClick={() => navigate("/advertise")}
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <span className="adv-topbar-title">Brand Application</span>
        <span style={{ width: 40 }} aria-hidden="true" />
      </div>

      <div className="adv-form">
        {formError ? (
          <section className="adv-card" role="alert">
            <div className="adv-field-error" style={{ fontSize: 14 }}>
              {formError}
            </div>
          </section>
        ) : null}

        {myApps.data && myApps.data.length > 0 ? (
          <section className="adv-card" aria-label="Your applications">
            <h2>Your applications</h2>
            <div className="adv-myapps">
              {myApps.data.map(app => (
                <div className="adv-myapp" key={app.id}>
                  <div>
                    <strong>{app.brandName}</strong>
                    <small>
                      {app.budgetCurrency} {app.budgetAmount} ·{" "}
                      {new Date(app.createdAt).toLocaleDateString()}
                    </small>
                  </div>
                  <span className={`adv-status ${app.status}`}>
                    {app.status.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="adv-card" aria-label="Business information">
          <h2>Business information</h2>
          <Field label="Brand / company name" required>
            <input
              value={brandName}
              onChange={e => setBrandName(e.target.value)}
              placeholder="e.g. Aarong Dairy"
              maxLength={160}
            />
          </Field>
          <div className="adv-row-2">
            <Field label="Category">
              <input
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="Food & Beverage"
                maxLength={80}
              />
            </Field>
            <Field label="Contact person">
              <input
                value={contactPerson}
                onChange={e => setContactPerson(e.target.value)}
                placeholder="Your name"
                maxLength={120}
              />
            </Field>
          </div>
          <div className="adv-row-2">
            <Field label="Business email" required>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="marketing@brand.com"
                maxLength={320}
              />
            </Field>
            <Field label="Phone / WhatsApp">
              <input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+880 1XXX XXXXXX"
                maxLength={32}
              />
            </Field>
          </div>
          <div className="adv-row-2">
            <Field label="Country">
              <input
                value={country}
                onChange={e => setCountry(e.target.value)}
                placeholder="Bangladesh"
                maxLength={64}
              />
            </Field>
            <Field label="Target market">
              <input
                value={targetMarket}
                onChange={e => setTargetMarket(e.target.value)}
                placeholder="e.g. Dhaka, 18–35"
                maxLength={64}
              />
            </Field>
          </div>
          <Field label="What do you sell?">
            <textarea
              value={productDetails}
              onChange={e => setProductDetails(e.target.value)}
              placeholder="Describe your products or services…"
              maxLength={5000}
            />
          </Field>
        </section>

        <section className="adv-card" aria-label="Objectives and formats">
          <h2>Goals & formats</h2>
          <Field label="Advertising objectives" required>
            <div className="adv-chips" role="group" aria-label="Objectives">
              {OBJECTIVES.map(o => (
                <button
                  key={o.id}
                  type="button"
                  className={`adv-chip${objectives.includes(o.id) ? " on" : ""}`}
                  aria-pressed={objectives.includes(o.id)}
                  onClick={() => toggle(objectives, o.id, setObjectives)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Campaign formats" required>
            <div className="adv-chips" role="group" aria-label="Formats">
              {FORMATS.map(f => (
                <button
                  key={f.id}
                  type="button"
                  className={`adv-chip${formats.includes(f.id) ? " on" : ""}`}
                  aria-pressed={formats.includes(f.id)}
                  onClick={() => toggle(formats, f.id, setFormats)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </Field>
        </section>

        <section className="adv-card" aria-label="Budget">
          <h2>Campaign budget</h2>
          <Field label="Currency" required>
            <div className="adv-currency" role="group" aria-label="Currency">
              {(["USD", "BDT"] as const).map(c => (
                <button
                  key={c}
                  type="button"
                  className={currency === c ? "on" : ""}
                  aria-pressed={currency === c}
                  onClick={() => setCurrency(c)}
                >
                  {c === "USD" ? "$ USD" : "৳ BDT"}
                </button>
              ))}
            </div>
          </Field>
          <Field
            label={`Total budget (${currency})`}
            required
            hint="Proposed budget only. Applying does not charge you or confirm a campaign cost."
          >
            <input
              className="big-input"
              inputMode="decimal"
              value={budget}
              onChange={e => setBudget(e.target.value)}
              placeholder={currency === "USD" ? "5,000" : "50,000"}
            />
          </Field>
          <div className="adv-row-2">
            <Field label="Preferred start">
              <input
                type="date"
                value={startsAt}
                onChange={e => setStartsAt(e.target.value)}
              />
            </Field>
            <Field label="Preferred end">
              <input
                type="date"
                value={endsAt}
                onChange={e => setEndsAt(e.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="adv-card" aria-label="Links">
          <h2>Website & product links</h2>
          <Field label="Campaign website">
            <input
              value={website}
              onChange={e => setWebsite(e.target.value)}
              placeholder="https://yourbrand.com/promo"
              inputMode="url"
            />
          </Field>
          {links.map((link, i) => (
            <div className="adv-link-row" key={i}>
              <div className="adv-link-row-head">
                <span>Link {i + 1}</span>
                <button
                  type="button"
                  className="adv-icon-btn"
                  aria-label={`Remove link ${i + 1}`}
                  onClick={() => setLinks(prev => prev.filter((_, x) => x !== i))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="adv-row-2">
                <select
                  value={link.kind}
                  onChange={e =>
                    setLinks(prev =>
                      prev.map((l, x) =>
                        x === i
                          ? { ...l, kind: e.target.value as LinkDraft["kind"] }
                          : l
                      )
                    )
                  }
                  aria-label="Link type"
                  style={{
                    border: "1px solid color-mix(in srgb, var(--text) 18%, transparent)",
                    borderRadius: 12,
                    padding: "12px 14px",
                    fontSize: 15,
                    background: "var(--card, #fff)",
                    color: "var(--text)",
                  }}
                >
                  <option value="website">Website</option>
                  <option value="landing">Landing page</option>
                  <option value="social">Social profile</option>
                  <option value="product">Product page</option>
                </select>
                <input
                  value={link.label}
                  onChange={e =>
                    setLinks(prev =>
                      prev.map((l, x) =>
                        x === i ? { ...l, label: e.target.value } : l
                      )
                    )
                  }
                  placeholder="Label (optional)"
                  maxLength={160}
                  aria-label="Link label"
                />
              </div>
              <input
                value={link.url}
                onChange={e =>
                  setLinks(prev =>
                    prev.map((l, x) =>
                      x === i ? { ...l, url: e.target.value } : l
                    )
                  )
                }
                placeholder="https://…"
                inputMode="url"
                aria-label="Link URL"
              />
              <div className="adv-row-2">
                <input
                  value={link.productName}
                  onChange={e =>
                    setLinks(prev =>
                      prev.map((l, x) =>
                        x === i ? { ...l, productName: e.target.value } : l
                      )
                    )
                  }
                  placeholder="Product name (optional)"
                  maxLength={200}
                  aria-label="Product name"
                />
                <input
                  value={link.price}
                  onChange={e =>
                    setLinks(prev =>
                      prev.map((l, x) =>
                        x === i ? { ...l, price: e.target.value } : l
                      )
                    )
                  }
                  placeholder={`Price (${currency}, optional)`}
                  inputMode="decimal"
                  aria-label="Product price"
                />
              </div>
            </div>
          ))}
          {links.length < 10 ? (
            <button
              type="button"
              className="adv-add-btn"
              onClick={() => setLinks(prev => [...prev, { ...EMPTY_LINK }])}
            >
              <Plus size={16} />
              Add a link
            </button>
          ) : null}
        </section>

        <section className="adv-card" aria-label="Verification documents">
          <h2>Verification documents</h2>
          <div className="adv-privacy-note">
            <Lock size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Optional trade license or business documents can support your
              application. Files are uploaded to a dedicated private bucket;
              reviewer access uses a time-limited signed link. PDF, PNG, JPG,
              or WEBP, up to 5 files and 10 MB per file.
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={e => handleFiles(e.target.files)}
            aria-label="Upload verification documents"
          />
          {docs.map(doc => (
            <div className="adv-doc-row" key={doc.key}>
              <span>{doc.fileName}</span>
              <span className="ok">
                <CheckCircle2 size={14} />
                Uploaded
              </span>
              <button
                type="button"
                className="adv-icon-btn"
                aria-label={`Remove ${doc.fileName}`}
                onClick={() =>
                  setDocs(prev => prev.filter(d => d.key !== doc.key))
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
          {docs.length < 5 ? (
            <button
              type="button"
              className="adv-add-btn"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <FileUp size={16} />
              )}
              {uploading ? "Uploading…" : "Upload document"}
            </button>
          ) : null}
        </section>

        <section className="adv-card">
          <div className="adv-privacy-note" style={{ marginBottom: 18 }}>
            <Lock size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Your application is private — only you and the JHILIK review
              team can see it. Nothing here is shown publicly.
            </span>
          </div>
          <button
            type="button"
            className="adv-cta full"
            disabled={submit.isPending}
            onClick={handleSubmit}
          >
            {submit.isPending ? (
              <Loader2 size={18} className="spin" />
            ) : null}
            {submit.isPending ? "Submitting…" : "Submit Application"}
          </button>
        </section>
      </div>
    </main>
  );
}
