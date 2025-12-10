/**
 * Extracts the S3 key from a full S3 URL.
 * @param {string} url The S3 URL.
 * @returns {string|null} The S3 key or null if the URL is invalid.
 */
export function getKeyFromUrl(url) {
  if (!url) return null;
  try {
    const urlObject = new URL(url);
    // The key is the pathname, but we need to remove the leading '/'
    return urlObject.pathname.substring(1);
  } catch (error) {
    console.error("Invalid URL for key extraction:", url);
    return null;
  }
}
