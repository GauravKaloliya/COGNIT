import { useRef } from "react";

function shallowEqualObject(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

export function useStableSelector(factory, deps) {
  const nextValue = factory();
  const ref = useRef(nextValue);
  if (!shallowEqualObject(ref.current, nextValue)) {
    ref.current = nextValue;
  }
  void deps;
  return ref.current;
}
