export default async function IdPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = await params;

  return (
    <div>
      <h1>Page: {id}</h1>
    </div>
  );
}
