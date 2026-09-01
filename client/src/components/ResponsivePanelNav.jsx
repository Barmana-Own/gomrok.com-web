import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon } from './ProductIcon.jsx';

export function usePanelNavigation(prefix = 'panel-menu') {
  const reactId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = `${prefix}-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const toggleMenu = useCallback(() => setMenuOpen((current) => !current), []);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1081px)');
    const closeForDesktop = (event) => {
      if (event.matches) setMenuOpen(false);
    };
    media.addEventListener?.('change', closeForDesktop);
    return () => media.removeEventListener?.('change', closeForDesktop);
  }, []);

  return {
    menuId,
    menuOpen,
    closeMenu,
    toggleMenu
  };
}

export function PanelMenuButton({ open, onClick, controls, inverse = false, alwaysVisible = false }) {
  return (
    <button
      className={`panel-menu-toggle${inverse ? ' panel-menu-toggle--inverse' : ''}${alwaysVisible ? ' panel-menu-toggle--always' : ''}`}
      type="button"
      aria-label={open ? 'بستن منوی اصلی' : 'باز کردن منوی اصلی'}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onClick}
    >
      <Icon name={open ? 'close' : 'menu'} size={22} />
      <span>منو</span>
    </button>
  );
}

export function PanelSidebar({
  open,
  onClose,
  id,
  className = '',
  title = 'منوی اصلی',
  subtitle = 'دسترسی سریع به بخش‌های پنل',
  dark = false,
  alwaysDrawer = false,
  children
}) {
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    document.body.classList.add('panel-menu-is-open');
    const panel = panelRef.current;
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () => [...(panel?.querySelectorAll(focusableSelector) || [])];
    const frame = window.requestAnimationFrame(() => (focusable()[0] || panel)?.focus?.());

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('panel-menu-is-open');
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus?.();
    };
  }, [open, onClose]);

  return (
    <>
      <button
        className={`panel-menu-backdrop${open ? ' is-open' : ''}${alwaysDrawer ? ' panel-menu-backdrop--always' : ''}`}
        type="button"
        aria-label="بستن منو"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        id={id}
        className={`${className} panel-sidebar${dark ? ' panel-sidebar--dark' : ''}${alwaysDrawer ? ' panel-sidebar--always' : ''}${open ? ' is-open' : ''}`}
        data-menu-open={open ? 'true' : 'false'}
        aria-label={title}
        aria-modal={open ? 'true' : undefined}
        role={open ? 'dialog' : 'complementary'}
        tabIndex={open ? -1 : undefined}
      >
        <div className="panel-menu-mobile-head">
          <div><strong>{title}</strong><small>{subtitle}</small></div>
          <button type="button" aria-label="بستن منوی اصلی" onClick={onClose}><Icon name="close" size={21} /></button>
        </div>
        {children}
      </aside>
    </>
  );
}
