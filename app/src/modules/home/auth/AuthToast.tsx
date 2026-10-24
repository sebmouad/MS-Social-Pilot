'use client';
import { useEffect } from 'react';
import { useToast, type ToastInput } from '@/components/Toast';

/** Shows one toast when `toast` changes. Render it inside AuthShell, which owns the toast region. */
export function AuthToast({ toast }: { toast: ToastInput | null }) {
  const api = useToast();
  useEffect(() => { if (toast) api.notify(toast); }, [toast, api]);
  return null;
}
