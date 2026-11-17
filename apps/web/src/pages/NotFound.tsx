import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-28 text-center">
      <div className="font-mono text-sm text-fg-subtle">404</div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">This square is empty.</h1>
      <Link to="/" className="mt-6 inline-block text-accent hover:underline">
        Back to STAKE Arena
      </Link>
    </div>
  );
}
