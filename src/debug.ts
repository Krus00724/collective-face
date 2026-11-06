/** Test hooks for the headless walkthrough in tools/. Inactive for visitors. */
const flag = (window as unknown as { __DEBUG?: { speed?: number; high?: boolean; backdrop?: string } }).__DEBUG;

export const debug = {
  on: !!flag,
  high: !!flag?.high,
  backdrop: flag?.backdrop,
  speed: flag?.speed ?? 1,
  expose(values: Record<string, unknown>) {
    if (flag) Object.assign(window, values);
  },
};
