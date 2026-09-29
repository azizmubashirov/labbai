/** Route-level loading state for the access-request entry pages, which only redirect or render the Requests page. */
export function AccessRequestsLoading() {
  return (
    <div className='flex min-h-0 flex-1 items-center justify-center px-6 py-8'>
      <span role='status' className='text-[var(--text-muted)] text-sm'>
        Loading requests…
      </span>
    </div>
  )
}
