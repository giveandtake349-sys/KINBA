import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft, CalendarClock, ImagePlus, Loader2, Package, Upload, X } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import { trpc } from "@/lib/trpc";
import { getImageDimensions, uploadImage } from "@/lib/mediaUpload";
import "./createDrop.css";

type ScheduleMode = "now" | "schedule";
type FieldErrors = Partial<Record<"title" | "description" | "terms" | "mediaUrl" | "originalPrice" | "discountedPrice" | "quantity" | "startsAt" | "endsAt", string>>;
type SubmitAction = "draft" | "publish" | "schedule";

const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_TERMS_LENGTH = 4000;
const MAX_IMAGE_URL_LENGTH = 1024;
const MAX_SCHEDULE_LEAD_MS = 30 * 24 * 60 * 60 * 1000;

function toDatetimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The drop could not be saved. Please try again.";
}

function validatePrice(value: string, label: string): string | undefined {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) {
    return `${label} must be a valid amount with up to two decimals.`;
  }
  if (Number(value) <= 0) return `${label} must be greater than zero.`;
  return undefined;
}

export default function CreateDrop() {
  const [, navigate] = useLocation();
  const auth = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveDraft = trpc.drops.saveDraft.useMutation();
  const publish = trpc.drops.publish.useMutation();
  const schedule = trpc.drops.schedule.useMutation();

  const returnTo = useMemo(() => {
    const query = new URLSearchParams(window.location.search);
    const value = query.get("returnTo");
    return value && value.startsWith("/") ? value : null;
  }, []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [terms, setTerms] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaDimensions, setMediaDimensions] = useState<{ width: number; height: number } | null>(null);
  const [mediaPreview, setMediaPreview] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [discountedPrice, setDiscountedPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("now");
  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [endsAtLocal, setEndsAtLocal] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [activeAction, setActiveAction] = useState<SubmitAction | null>(null);
  const [submitAction, setSubmitAction] = useState<SubmitAction>("draft");

  const minDate = useMemo(() => toDatetimeLocalValue(new Date()), []);
  const maxDate = useMemo(() => toDatetimeLocalValue(new Date(Date.now() + MAX_SCHEDULE_LEAD_MS)), []);
  const isSubmitting = saveDraft.isPending || publish.isPending || schedule.isPending || activeAction !== null;

  useEffect(() => {
    return () => {
      if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    };
  }, [mediaPreview]);

  useEffect(() => {
    if (!auth.loading && !auth.isAuthenticated) auth.openAuth();
  }, [auth]);

  const goBack = () => navigate(returnTo ?? "/drops");

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError("");
    setFieldErrors(current => ({ ...current, mediaUrl: undefined }));
    setUploading(true);
    try {
      const dimensions = await getImageDimensions(file);
      const preview = URL.createObjectURL(file);
      setMediaPreview(current => {
        if (current) URL.revokeObjectURL(current);
        return preview;
      });
      const url = await uploadImage("post", file);
      setMediaDimensions(dimensions);
      setMediaUrl(url);
    } catch (error) {
      setUploadError(errorMessage(error));
      setMediaPreview("");
      setMediaUrl("");
      setMediaDimensions(null);
    } finally {
      setUploading(false);
    }
  };

  const validate = (action: SubmitAction): FieldErrors => {
    const errors: FieldErrors = {};
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3 || trimmedTitle.length > 180) {
      errors.title = "Title must be between 3 and 180 characters.";
    }
    if (!description.trim() || description.trim().length > MAX_DESCRIPTION_LENGTH) {
      errors.description = "Description is required and must be 4000 characters or fewer.";
    }
    if (!terms.trim() || terms.trim().length > MAX_TERMS_LENGTH) {
      errors.terms = "Terms are required and must be 4000 characters or fewer.";
    }
    if (!mediaUrl.trim() || mediaUrl.trim().length > MAX_IMAGE_URL_LENGTH) {
      errors.mediaUrl = "Choose an image before saving the drop.";
    }
    const originalError = validatePrice(originalPrice, "Original price");
    if (originalError) errors.originalPrice = originalError;
    const discountedError = validatePrice(discountedPrice, "Discounted price");
    if (discountedError) errors.discountedPrice = discountedError;
    if (!originalError && !discountedError && Number(discountedPrice) >= Number(originalPrice)) {
      errors.discountedPrice = "Discounted price must be less than original price.";
    }
    const parsedQuantity = Number(quantity);
    if (!/^\d+$/.test(quantity.trim()) || !Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
      errors.quantity = "Quantity must be a positive integer.";
    }

    const startsAt = startsAtLocal ? new Date(startsAtLocal) : null;
    const endsAt = endsAtLocal ? new Date(endsAtLocal) : null;
    if (startsAtLocal && Number.isNaN(startsAt?.getTime())) errors.startsAt = "Start time is invalid.";
    if (endsAtLocal && Number.isNaN(endsAt?.getTime())) errors.endsAt = "End time is invalid.";
    if (startsAt && !Number.isNaN(startsAt.getTime()) && startsAt.getTime() > Date.now() + MAX_SCHEDULE_LEAD_MS) {
      errors.startsAt = "Start time must be within the next 30 days.";
    }
    if (endsAt && !Number.isNaN(endsAt.getTime()) && endsAt.getTime() <= Date.now()) {
      errors.endsAt = "End time must be in the future.";
    }
    if (startsAt && endsAt && !Number.isNaN(startsAt.getTime()) && !Number.isNaN(endsAt.getTime()) && endsAt <= startsAt) {
      errors.endsAt = "End time must be after the start time.";
    }
    if (action === "schedule" && !startsAtLocal) errors.startsAt = "Choose a start time to schedule the drop.";
    if (action !== "draft" && !endsAtLocal) errors.endsAt = "An end time is required to publish the drop.";
    if (scheduleMode === "schedule" && action !== "draft" && !startsAtLocal) {
      errors.startsAt = "Choose a start time to schedule the drop.";
    }
    return errors;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>, action: SubmitAction) => {
    event.preventDefault();
    if (isSubmitting || !auth.isAuthenticated) {
      if (!auth.loading && !auth.isAuthenticated) auth.openAuth();
      return;
    }
    setFormError("");
    const errors = validate(action);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setActiveAction(action);
    try {
      const startsAt = startsAtLocal ? new Date(startsAtLocal).toISOString() : null;
      const endsAt = endsAtLocal ? new Date(endsAtLocal).toISOString() : null;
      const drop = await saveDraft.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        terms: terms.trim(),
        mediaUrl: mediaUrl.trim(),
        mediaWidth: mediaDimensions?.width ?? null,
        mediaHeight: mediaDimensions?.height ?? null,
        originalPrice: originalPrice.trim(),
        discountedPrice: discountedPrice.trim(),
        quantity: Number(quantity),
        startsAt,
        endsAt,
      });
      let result = drop;
      if (action === "publish") {
        result = await publish.mutateAsync({ dropId: drop.id, startsAt: scheduleMode === "now" ? null : startsAt, endsAt });
      } else if (action === "schedule") {
        result = await schedule.mutateAsync({ dropId: drop.id, startsAt, endsAt });
      }
      if (returnTo) {
        window.history.back();
      } else {
        navigate(`/drops/${result.id}`);
      }
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setActiveAction(null);
    }
  };

  if (auth.loading) {
    return <div className="kinba-app drops-shell"><main className="drops-page section-shell"><p className="create-drop-status">Checking access…</p></main></div>;
  }

  if (!auth.isAuthenticated) {
    return (
      <div className="kinba-app drops-shell">
        <main className="drops-page section-shell">
          <button type="button" className="drops-back" onClick={goBack}><ArrowLeft size={16} /> Back to drops</button>
          <div className="drop-state" role="status">
            <span className="drop-state-icon" aria-hidden="true"><Package size={24} /></span>
            <h3>Sign in to create a drop.</h3>
            <p>Creating a drop requires an authenticated account.</p>
            <button type="button" className="primary-btn" onClick={() => auth.openAuth()}>Sign in</button>
          </div>
        </main>
        {auth.authDialogOpen ? <SupabaseAuthDialog open onOpenChange={open => (open ? auth.openAuth() : auth.closeAuth())} /> : null}
      </div>
    );
  }

  return (
    <div className="kinba-app drops-shell">
      <main className="drops-page section-shell create-drop-page">
        <button type="button" className="drops-back" onClick={goBack}><ArrowLeft size={16} /> Back to drops</button>
        <header className="drops-header create-drop-header">
          <div>
            <p className="eyebrow eyebrow--bright"><Package size={14} aria-hidden="true" /> Limited drops</p>
            <h1>Create a drop</h1>
            <p className="drops-lede">Create a limited offer, save it for later, or publish it to your community.</p>
          </div>
        </header>

        <form className="create-drop-form" onSubmit={event => void handleSubmit(event, submitAction)} noValidate>
          <section className="create-drop-section" aria-labelledby="create-drop-details">
            <div className="create-drop-section-heading"><h2 id="create-drop-details">Drop details</h2><span>Required</span></div>
            <label htmlFor="drop-title">Title<input id="drop-title" value={title} onChange={event => setTitle(event.target.value)} minLength={3} maxLength={180} placeholder="What are you offering?" aria-invalid={fieldErrors.title ? true : undefined} />{fieldErrors.title ? <span className="create-drop-field-error" role="alert">{fieldErrors.title}</span> : null}</label>
            <label htmlFor="drop-description">Description<textarea id="drop-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={MAX_DESCRIPTION_LENGTH} rows={5} placeholder="Tell people what makes this drop special…" aria-invalid={fieldErrors.description ? true : undefined} />{fieldErrors.description ? <span className="create-drop-field-error" role="alert">{fieldErrors.description}</span> : null}</label>
            <label htmlFor="drop-terms">Terms<textarea id="drop-terms" value={terms} onChange={event => setTerms(event.target.value)} maxLength={MAX_TERMS_LENGTH} rows={4} placeholder="Share any claim, delivery, or availability terms…" aria-invalid={fieldErrors.terms ? true : undefined} />{fieldErrors.terms ? <span className="create-drop-field-error" role="alert">{fieldErrors.terms}</span> : null}</label>
          </section>

          <section className="create-drop-section" aria-labelledby="create-drop-media">
            <div className="create-drop-section-heading"><h2 id="create-drop-media">Cover image</h2><span>Required</span></div>
            <input ref={fileInputRef} className="create-drop-hidden-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={event => void handleImageChange(event)} />
            {mediaPreview ? <div className="create-drop-preview"><img src={mediaPreview} alt="Selected drop cover preview" /><button type="button" className="create-drop-remove" onClick={() => { setMediaPreview(""); setMediaUrl(""); setMediaDimensions(null); }} aria-label="Remove cover image"><X size={16} /></button></div> : <button type="button" className="create-drop-upload" onClick={() => fileInputRef.current?.click()} disabled={uploading}><span className="create-drop-upload-icon">{uploading ? <Loader2 size={22} className="create-drop-spinner" /> : <ImagePlus size={22} />}</span><strong>{uploading ? "Uploading image…" : "Choose an image"}</strong><span>JPG, PNG, WEBP, or GIF up to 5MB</span></button>}
            {mediaPreview ? <button type="button" className="create-drop-change" onClick={() => fileInputRef.current?.click()} disabled={uploading}><Upload size={15} /> Change image</button> : null}
            {uploadError ? <span className="create-drop-field-error" role="alert">{uploadError}</span> : null}
            {fieldErrors.mediaUrl ? <span className="create-drop-field-error" role="alert">{fieldErrors.mediaUrl}</span> : null}
          </section>

          <section className="create-drop-section" aria-labelledby="create-drop-offer">
            <div className="create-drop-section-heading"><h2 id="create-drop-offer">Offer</h2><span>Required</span></div>
            <div className="create-drop-form-row"><label htmlFor="drop-original-price">Original price<input id="drop-original-price" inputMode="decimal" value={originalPrice} onChange={event => setOriginalPrice(event.target.value)} placeholder="4500.00" aria-invalid={fieldErrors.originalPrice ? true : undefined} />{fieldErrors.originalPrice ? <span className="create-drop-field-error" role="alert">{fieldErrors.originalPrice}</span> : null}</label><label htmlFor="drop-discounted-price">Drop price<input id="drop-discounted-price" inputMode="decimal" value={discountedPrice} onChange={event => setDiscountedPrice(event.target.value)} placeholder="3500.00" aria-invalid={fieldErrors.discountedPrice ? true : undefined} />{fieldErrors.discountedPrice ? <span className="create-drop-field-error" role="alert">{fieldErrors.discountedPrice}</span> : null}</label></div>
            <label htmlFor="drop-quantity">Quantity<input id="drop-quantity" inputMode="numeric" value={quantity} onChange={event => setQuantity(event.target.value)} placeholder="25" aria-invalid={fieldErrors.quantity ? true : undefined} />{fieldErrors.quantity ? <span className="create-drop-field-error" role="alert">{fieldErrors.quantity}</span> : null}</label>
          </section>

          <section className="create-drop-section" aria-labelledby="create-drop-timing">
            <div className="create-drop-section-heading"><h2 id="create-drop-timing">Timing</h2><span>Optional for drafts</span></div>
            <div className="create-drop-segmented" role="radiogroup" aria-label="Drop timing"><button type="button" role="radio" aria-checked={scheduleMode === "now"} className={scheduleMode === "now" ? "active" : ""} onClick={() => { setScheduleMode("now"); setStartsAtLocal(""); }}>Now</button><button type="button" role="radio" aria-checked={scheduleMode === "schedule"} className={scheduleMode === "schedule" ? "active" : ""} onClick={() => setScheduleMode("schedule")}>Schedule</button></div>
            {scheduleMode === "schedule" ? <label htmlFor="drop-starts-at">Start time<input id="drop-starts-at" type="datetime-local" min={minDate} max={maxDate} value={startsAtLocal} onChange={event => setStartsAtLocal(event.target.value)} aria-invalid={fieldErrors.startsAt ? true : undefined} />{fieldErrors.startsAt ? <span className="create-drop-field-error" role="alert">{fieldErrors.startsAt}</span> : null}</label> : null}
            <label htmlFor="drop-ends-at">End time <span className="create-drop-optional">(required to publish)</span><input id="drop-ends-at" type="datetime-local" min={minDate} max={maxDate} value={endsAtLocal} onChange={event => setEndsAtLocal(event.target.value)} aria-invalid={fieldErrors.endsAt ? true : undefined} />{fieldErrors.endsAt ? <span className="create-drop-field-error" role="alert">{fieldErrors.endsAt}</span> : null}</label>
          </section>

          {formError ? <p className="form-message form-message--error" role="alert">{formError}</p> : null}
          <div className="create-drop-actions"><button type="button" className="muted-btn" onClick={goBack} disabled={isSubmitting}>Cancel</button><button type="submit" className="secondary-btn" onClick={() => setSubmitAction("draft")} disabled={isSubmitting}>{activeAction === "draft" ? "Saving…" : "Save draft"}</button><button type="submit" className="muted-btn" onClick={() => setSubmitAction("schedule")} disabled={isSubmitting}>{activeAction === "schedule" ? "Scheduling…" : "Schedule"}</button><button type="submit" className="primary-btn" onClick={() => setSubmitAction("publish")} disabled={isSubmitting}>{activeAction === "publish" ? "Publishing…" : "Publish now"}</button></div>
        </form>
      </main>
      {auth.authDialogOpen ? <SupabaseAuthDialog open onOpenChange={open => (open ? auth.openAuth() : auth.closeAuth())} /> : null}
    </div>
  );
}
