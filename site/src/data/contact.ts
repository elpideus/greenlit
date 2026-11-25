/**
 * Contact details shown on the site. The email address is not kept in the repository: set PUBLIC_CONTACT_EMAIL
 * when building (a repository variable for the Pages workflow, or site/.env locally). Without it the site shows
 * the other links only.
 */
export const contactEmail: string = (import.meta.env.PUBLIC_CONTACT_EMAIL ?? '').trim()
export const links = {
  website: 'https://elpideus.com',
  instagram: 'https://instagram.com/elpideus',
  github: 'https://github.com/elpideus',
  youtube: 'https://youtube.com/@elpideus',
}
