import { useState } from 'react';

export function StatusTimeline({ items = [] }) {
  return (
    <ol className="platform-timeline" aria-label="تایم‌لاین وضعیت">
      {items.length ? items.map((item, index) => (
        <li className={`platform-timeline__item${item.current ? ' platform-timeline__item--current' : ''}${item.done ? ' platform-timeline__item--done' : ''}`} key={`${item.label}-${index}`}>
          <span className="platform-timeline__dot" aria-hidden="true" />
          <div><strong>{item.label}</strong><small>{item.detail || item.state || 'در انتظار شواهد'}</small></div>
        </li>
      )) : <li className="platform-empty-inline">هنوز رویداد قابل نمایش نیست.</li>}
    </ol>
  );
}

export function DocCard({ document, onOpen }) {
  return (
    <article className="platform-doc-card">
      <div className="platform-doc-card__icon">▤</div>
      <div className="platform-doc-card__copy">
        <strong>{document?.docType || 'سند'}</strong>
        <small>نسخه {document?.versionNo || '—'} · {document?.state === 'APPROVED' ? 'قفل‌شده' : 'در حال بررسی'} · حساسیت {document?.sensitivity || 'P1'}</small>
        <small>مالک {document?.ownerOrgId || '—'} · بارگذار {document?.uploaderUserId || '—'} · تأییدکننده {document?.approverUserId || '—'}</small>
        <small>Deadline: {document?.deadlineAt || '—'} · Hash: {document?.fileHash ? `${String(document.fileHash).slice(0, 12)}…` : '—'}</small>
      </div>
      {onOpen && <button type="button" onClick={() => onOpen(document)}>مشاهده</button>}
    </article>
  );
}

export function MoneyBreakdown({ items = [], currency = 'EUR' }) {
  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return (
    <div className="platform-money">
      {items.length ? items.map((item) => <div className="platform-money__row" key={item.label}><span>{item.label}</span><strong>{Number(item.amount || 0).toLocaleString('fa-IR')} {item.currency || currency}</strong></div>) : <div className="platform-empty-inline">اطلاعات مالی رابطه‌ای هنوز ثبت نشده است.</div>}
      {items.length > 0 && <div className="platform-money__total"><span>جمع مجاز این رابطه</span><strong>{total.toLocaleString('fa-IR')} {currency}</strong></div>}
    </div>
  );
}

export function ApprovalDialog({ open, title = 'تأیید عملیات', description, onCancel, onConfirm, busy = false, children }) {
  if (!open) return null;
  return (
    <div className="platform-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel?.(); }}>
      <section className="platform-dialog" role="dialog" aria-modal="true" aria-labelledby="platform-dialog-title">
        <span className="platform-eyebrow">عملیات کنترل‌شده</span>
        <h2 id="platform-dialog-title">{title}</h2>
        <p>{description || 'این تغییر پس از ثبت در تاریخچه قابل پیگیری است.'}</p>
        {children}
        <div className="platform-dialog__actions"><button type="button" onClick={onCancel} disabled={busy}>انصراف</button><button className="platform-button platform-button--primary" type="button" onClick={onConfirm} disabled={busy}>{busy ? 'در حال ثبت…' : 'تأیید و ثبت'}</button></div>
      </section>
    </div>
  );
}

export function EvidenceGallery({ evidence = [] }) {
  return (
    <div className="platform-evidence-gallery">
      {evidence.length ? evidence.map((item, index) => <div className="platform-evidence" key={`${item.ref || item}-${index}`}><span>{item.type || 'مدرک'}</span><strong>{item.label || item.ref || `شاهد ${index + 1}`}</strong></div>) : <div className="platform-empty-inline">شاهدی ثبت نشده است.</div>}
    </div>
  );
}

export function RiskBadge({ flags = [] }) {
  const list = Array.isArray(flags) ? flags : [];
  if (!list.length) return <span className="platform-risk platform-risk--clear">بدون پرچم ریسک</span>;
  return <span className="platform-risk platform-risk--warning">{list.length} پرچم ریسک</span>;
}

export function AuditDrawer({ open, items = [], onClose }) {
  if (!open) return null;
  return (
    <div className="platform-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <aside className="platform-audit-drawer" aria-label="تاریخچه حسابرسی">
        <div className="platform-audit-drawer__header"><div><span className="platform-eyebrow">append-only</span><h2>تاریخچه رویدادها</h2></div><button type="button" onClick={onClose} aria-label="بستن">×</button></div>
        <StatusTimeline items={items.map((item) => ({ label: item.event_type || item.eventName, detail: item.created_at || item.occurredAt }))} />
      </aside>
    </div>
  );
}

export function ContactMasked({ contact, onReveal, revealed = false, expiresAt }) {
  return (
    <div className="platform-contact">
      <div><span>تماس کنترل‌شده</span><strong>{contact?.phone || '••••••'}</strong><small>{revealed ? `تا ${expiresAt || 'زمان محدود'}` : 'شماره پیش‌فرض ماسک است'}</small></div>
      {!revealed && onReveal && <button type="button" onClick={onReveal}>درخواست نمایش</button>}
    </div>
  );
}

export function ContactRevealDialog({ open, onCancel, onConfirm, reason, setReason, busy = false }) {
  if (!open) return null;
  return (
    <div className="platform-dialog-backdrop" role="presentation">
      <section className="platform-dialog" role="dialog" aria-modal="true" aria-labelledby="reveal-dialog-title">
        <span className="platform-eyebrow">RV$ · زمان‌دار</span>
        <h2 id="reveal-dialog-title">نمایش موقت تماس</h2>
        <p>دلیل عملیاتی را ثبت کن. مجوز حداکثر ۱۵ دقیقه معتبر است و در حسابرسی می‌ماند.</p>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="دلیل نیاز به تماس کامل" rows="3" />
        <div className="platform-dialog__actions"><button type="button" onClick={onCancel} disabled={busy}>انصراف</button><button className="platform-button platform-button--primary" type="button" onClick={onConfirm} disabled={busy}>{busy ? 'در حال ثبت…' : 'ثبت دلیل و درخواست'}</button></div>
      </section>
    </div>
  );
}

export function usePlatformNotice() {
  const [notice, setNotice] = useState(null);
  return { notice, setNotice, clearNotice: () => setNotice(null) };
}
