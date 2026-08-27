import { useEffect, useRef, useState } from "react";

/** Element size, kept current with a ResizeObserver - charts need real pixels. */
export function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ width: box.width, height: box.height });
    });
    observer.observe(node);
    setSize({ width: node.clientWidth, height: node.clientHeight });

    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}
