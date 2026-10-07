// Pages has no Node API. Its public build must not request local backend paths.
export const STATIC_DEMO = import.meta.env.MODE === "pages";
