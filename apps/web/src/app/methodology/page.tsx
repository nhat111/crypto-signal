import { redirect } from 'next/navigation';

/**
 * The page moved under /guide when it became a third tab there. This
 * keeps the original address working: it was published and may already
 * have been shared, and a link that quietly 404s is a worse outcome than
 * one extra file.
 */
export default function MethodologyRedirect(): never {
  redirect('/guide/methodology');
}
