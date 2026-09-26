import type { SVGProps } from 'react'

/**
 * Labbai brand mark: a rounded square in the brand color with a white "L".
 * @param props - SVG properties; `fill` recolors the square.
 */
export function Sim(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 222 222'
      fill='#33C482'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <rect width='222' height='222' rx='48' />
      <path
        transform='translate(83.23 67.35)'
        fill='#FFFFFF'
        d='M55.55 87.30L0 87.30L0 0L17.87 0L17.87 72.48L55.55 72.48L55.55 87.30Z'
      />
    </svg>
  )
}
