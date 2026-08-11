import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section aria-labelledby="not-found-title">
      <h1 id="not-found-title">Page not found</h1>
      <Link to="/dashboard" className="btn">
        Back to dashboard
      </Link>
    </section>
  );
}
