'use client';
import {useLayoutEffect,type RefObject} from 'react';

/** React action forms may reset associated controls in a sidebar portal after a
 * handled failure. These editors own their values and navigate on success, so
 * a native reset must not mutate DOM controls independently of their state.
 * Use a native capture listener: delegated synthetic reset handlers do not
 * reliably intercept the action reset for externally associated controls.
 */
export function usePreserveFormState(ref:RefObject<HTMLFormElement|null>):void{
 useLayoutEffect(()=>{
  const form=ref.current;if(!form)return;
  const preserve=(event:Event)=>event.preventDefault();
  form.addEventListener('reset',preserve,true);
  return()=>form.removeEventListener('reset',preserve,true);
 },[ref]);
}
