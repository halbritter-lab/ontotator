/** The host a link leads to, for its accessible name; the text itself if it is no URL. */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** "View HP:0001250 on hpo.jax.org" */
export const viewLabel = (termId: string, url: string): string => `View ${termId} on ${hostOf(url)}`;
