"use client";
import { useEffect, useRef, type InputHTMLAttributes } from "react";

/** Checkbox that can show the mixed "some selected" state. Used by the DataTable select-all header. */
export function IndeterminateCheckbox({ indeterminate, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { indeterminate: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" {...props} />;
}
