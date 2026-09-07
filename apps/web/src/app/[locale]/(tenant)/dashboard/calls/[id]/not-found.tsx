export default function CallNotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-xl font-semibold">Call not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This call doesn&apos;t exist or you don&apos;t have access to it.
      </p>
    </div>
  );
}
