/**
 * Copy text with a legacy execCommand fallback for non-secure contexts.
 * Returns true when the copy succeeded, false otherwise.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  try {
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    // Always clean up the helper textarea, even if select/copy throws.
    document.body.removeChild(ta);
  }
};
