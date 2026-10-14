import { useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  XCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./advertise.css";

type AppStatus =
  | "draft"
  | "submitted"
  | "pending"
  | "info_requested"
  | "approved"
  | "rejected";

const STATUS_FILTERS: { id: AppStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "submitted", label: "Submitted" },
  { id: "pending", label: "Pending" },
  { id: "info_requested", label: "Info requested" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

const REVIEW_ACTIONS = [
  { to: "info_requested", label: "Request info", kind: "ghost" },
  { to: "rejected", label: "Reject", kind: "danger" },
  { to: "approved", label: "Approve", kind: "go" },
] as const;

function formatMoney(amount: string | null, currency: string | null): string {
  if (!amount) return "—";
  const symbol = currency === "BDT" ? "৳" : "$";
  return `${symbol}${Number(amount).toLocaleString()}`;
}

function formatDate(value: string | Date | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

/**
 * Admin "Brand Applications" section. Lists applications without contact PII;
 * the expanded detail shows everything (admin-only) plus verification docs
 * via short-lived signed URLs and the audit trail.
 */
export default function AdminBrandApplications() {
  const [statusFilter, setStatusFilter] = useState<AppStatus | "all">("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const utils = trpc.useUtils();

  const list = trpc.brands.admin.list.useQuery(
    {
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: 25,
      offset: 0,
    },
    { refetchOnWindowFocus: false }
  );
  const detail = trpc.brands.admin.detail.useQuery(
    { id: openId ?? 0 },
    { enabled: openId != null, refetchOnWindowFocus: false }
  );
  const review = trpc.brands.admin.review.useMutation();

  const handleReview = async (
    id: number,
    toStatus: "info_requested" | "approved" | "rejected"
  ) => {
    setNotice("");
    try {
      await review.mutateAsync({ id, toStatus, note: note.trim() });
      setNote("");
      await utils.brands.admin.list.invalidate();
      await utils.brands.admin.detail.invalidate();
      setNotice(`Application ${toStatus.replace(/_/g, " ")}.`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Review action failed."
      );
    }
  };

  const app = detail.data?.application;
  const detailData = detail.data;

  return (
    <>
      <div className="admin-section-heading">
        <div>
          <p className="eyebrow">Brand advertising</p>
          <h2>Brand applications</h2>
        </div>
        <FileText size={24} />
      </div>
      <p className="admin-help">
        Review brand advertising applications. The list hides contact details —
        open an application to verify the business, then approve, reject, or
        request more information. Every action is audit-logged and notifies the
        applicant.
      </p>

      <div className="admin-reports-filters">
        <label>
          Status
          <select
            value={statusFilter}
            onChange={event => {
              setStatusFilter(event.target.value as AppStatus | "all");
              setOpenId(null);
            }}
          >
            {STATUS_FILTERS.map(f => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {notice ? (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      ) : null}

      {list.isLoading ? (
        <p className="profile-loading-note">Loading applications…</p>
      ) : list.data && list.data.items.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Brand</th>
                <th>Budget</th>
                <th>Status</th>
                <th>Applied</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map(item => (
                <tr
                  key={item.id}
                  onClick={() =>
                    setOpenId(openId === item.id ? null : item.id)
                  }
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <strong>{item.brandName}</strong>
                    <br />
                    <small style={{ color: "var(--muted)" }}>
                      {item.category || "—"} · {item.country || "—"}
                    </small>
                  </td>
                  <td>
                    {formatMoney(item.budgetAmount, item.budgetCurrency)}
                  </td>
                  <td>
                    <span className={`adv-status ${item.status}`}>
                      {item.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td>{formatDate(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="profile-loading-note">No applications found.</p>
      )}

      {openId != null ? (
        <div
          className="admin-detail-panel"
          style={{
            marginTop: 16,
            borderTop: "1px solid var(--border, #e4e6eb)",
            paddingTop: 16,
          }}
        >
          {detail.isLoading ? (
            <p className="profile-loading-note">Loading detail…</p>
          ) : app && detailData ? (
            <>
              <h3 style={{ margin: "0 0 12px" }}>
                {app.brandName} — review
              </h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <tbody>
                    <tr>
                      <td>Contact person</td>
                      <td>{app.contactPerson || "—"}</td>
                    </tr>
                    <tr>
                      <td>Email</td>
                      <td>{app.email || "—"}</td>
                    </tr>
                    <tr>
                      <td>Phone</td>
                      <td>{app.phone || "—"}</td>
                    </tr>
                    <tr>
                      <td>Country / target</td>
                      <td>
                        {app.country || "—"} / {app.targetMarket || "—"}
                      </td>
                    </tr>
                    <tr>
                      <td>Website</td>
                      <td>
                        {app.website ? (
                          <a
                            href={app.website}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {app.website} <ExternalLink size={12} />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td>Objectives</td>
                      <td>{(app.objectives ?? []).join(", ") || "—"}</td>
                    </tr>
                    <tr>
                      <td>Formats</td>
                      <td>{(app.formats ?? []).join(", ") || "—"}</td>
                    </tr>
                    <tr>
                      <td>Total budget</td>
                      <td>
                        <strong>
                          {formatMoney(app.budgetAmount, app.budgetCurrency)}
                        </strong>
                      </td>
                    </tr>
                    <tr>
                      <td>Creator pool / fee</td>
                      <td>
                        {app.creatorPool || app.serviceFee
                          ? `${formatMoney(app.creatorPool, app.budgetCurrency)} / ${formatMoney(app.serviceFee, app.budgetCurrency)}`
                          : "Not set yet"}
                      </td>
                    </tr>
                    <tr>
                      <td>Schedule</td>
                      <td>
                        {formatDate(app.startsAt)} → {formatDate(app.endsAt)}
                      </td>
                    </tr>
                    <tr>
                      <td>Product details</td>
                      <td>{app.productDetails || "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {detailData.links.length > 0 ? (
                <>
                  <h4 style={{ margin: "16px 0 8px" }}>Links</h4>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>URL</th>
                          <th>Product</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailData.links.map(link => (
                          <tr key={link.id}>
                            <td>{link.kind}</td>
                            <td>
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                {link.label || link.url} <ExternalLink size={12} />
                              </a>
                            </td>
                            <td>
                              {link.productName || "—"}
                              {link.price
                                ? ` (${formatMoney(link.price, app.budgetCurrency)})`
                                : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              {detailData.documents.length > 0 ? (
                <>
                  <h4 style={{ margin: "16px 0 8px" }}>
                    Verification documents
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {detailData.documents.map((doc, i) => (
                      <li key={i}>
                        <a
                          href={doc.viewUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {doc.fileName} <ExternalLink size={12} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p
                  style={{
                    color: "var(--muted)",
                    fontSize: 13,
                    margin: "16px 0 0",
                  }}
                >
                  No verification documents attached.
                </p>
              )}

              {detailData.audit.length > 0 ? (
                <>
                  <h4 style={{ margin: "16px 0 8px" }}>Audit trail</h4>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 18,
                      fontSize: 13,
                      color: "var(--muted)",
                    }}
                  >
                    {detailData.audit.map(entry => (
                      <li key={entry.id}>
                        <strong>{entry.action}</strong> —{" "}
                        {formatDate(entry.createdAt)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              <h4 style={{ margin: "16px 0 8px" }}>Review decision</h4>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Optional note to the applicant…"
                maxLength={2000}
                rows={2}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "1px solid var(--border, #e4e6eb)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 14,
                  fontFamily: "inherit",
                  marginBottom: 10,
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                {REVIEW_ACTIONS.map(action => (
                  <button
                    key={action.to}
                    type="button"
                    disabled={review.isPending}
                    onClick={() => handleReview(app.id, action.to)}
                    style={{
                      flex: 1,
                      padding: "11px",
                      borderRadius: 10,
                      border: "none",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: review.isPending ? "not-allowed" : "pointer",
                      background:
                        action.kind === "go"
                          ? "var(--blue)"
                          : action.kind === "danger"
                            ? "#fde8e8"
                            : "var(--bg, #f0f2f5)",
                      color:
                        action.kind === "go"
                          ? "#fff"
                          : action.kind === "danger"
                            ? "#d03636"
                            : "var(--text)",
                      opacity: review.isPending ? 0.6 : 1,
                    }}
                  >
                    {review.isPending ? (
                      <Loader2 size={14} />
                    ) : action.to === "approved" ? (
                      <CheckCircle2
                        size={14}
                        style={{ verticalAlign: "-2px", marginRight: 4 }}
                      />
                    ) : action.to === "rejected" ? (
                      <XCircle
                        size={14}
                        style={{ verticalAlign: "-2px", marginRight: 4 }}
                      />
                    ) : null}
                    {action.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="profile-loading-note">Could not load application.</p>
          )}
        </div>
      ) : null}
    </>
  );
}
