import { useEffect, useRef } from "react";

/** False after the component unmounts — guard async setState on mobile browsers. */
export function useMountedRef(): { readonly current: boolean } {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}
