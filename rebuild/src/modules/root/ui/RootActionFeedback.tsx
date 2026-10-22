'use client';
import { useEffect, useRef } from 'react';
import { useToast } from '@/components/Toast';
import { useRootInterface } from './RootInterface';

/** Unknown mutation outcomes offer a state refresh; never replay a privileged write from a toast. */
export function useRootActionFeedback(error: string, notice: string, review: () => void, noticeTone: 'success' | 'error' | 'info' = 'success') {
  const toast = useToast();
  const copy = useRootInterface();
  const latest = useRef({ toast, copy, review }); latest.current = { toast, copy, review };
  useEffect(() => {
    if (!error) return;
    const { toast, copy, review } = latest.current;
    const id = toast.failed(error, review, copy.retry);
    return () => toast.dismiss(id);
  }, [error]);
  useEffect(() => { if (notice) latest.current.toast.notify({ title: notice, tone: noticeTone }); }, [notice, noticeTone]);
}
