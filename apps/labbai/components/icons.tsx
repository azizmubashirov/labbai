import type { SVGProps } from 'react'
import { useId } from 'react'

export function EnrichmentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox='0 0 24 24'
      fill='currentColor'
      role='img'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path d='M12 2.5l1.9 4.6 4.6 1.9-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.9L12 2.5z' />
      <path d='M18.5 14l.95 2.3 2.3.95-2.3.95L18.5 20.5l-.95-2.3-2.3-.95 2.3-.95.95-2.3z' />
      <path d='M5.5 14.5l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7.7-1.7z' />
    </svg>
  )
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <circle cx='11' cy='11' r='8' />
      <path d='m21 21-4.3-4.3' />
    </svg>
  )
}

export function AgentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='21'
      height='24'
      viewBox='0 0 21 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M15.67 9.25H4.67C2.64 9.25 1 10.89 1 12.92V18.42C1 20.44 2.64 22.08 4.67 22.08H15.67C17.69 22.08 19.33 20.44 19.33 18.42V12.92C19.33 10.89 17.69 9.25 15.67 9.25Z'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M10.17 5.58C11.18 5.58 12 4.76 12 3.75C12 2.74 11.18 1.92 10.17 1.92C9.15 1.92 8.33 2.74 8.33 3.75C8.33 4.76 9.15 5.58 10.17 5.58Z'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M10.17 5.59V9.25M7.42 16.59V14.75M12.92 14.75V16.59'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function ApiIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='30'
      height='30'
      viewBox='0 0 30 30'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M5.61 24.39C8.5 27.28 12.47 25.47 13.56 24.39L15.72 22.22L7.78 14.28L5.61 16.44C4.53 17.53 2.72 21.5 5.61 24.39ZM5.61 24.39L2 28M24.39 5.61C21.5 2.72 17.53 4.53 16.44 5.61L14.28 7.78L22.22 15.72L24.39 13.56C25.47 12.47 27.28 8.5 24.39 5.61ZM24.39 5.61L28 2M15.72 9.22L12.83 12.11M20.78 14.28L17.89 17.17'
        stroke='currentColor'
        strokeWidth='2.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function ConditionalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='28'
      height='29'
      viewBox='0 0 28 29'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M23.1 1.02C22.18 1.01 21.29 1.34 20.59 1.93C19.89 2.52 19.41 3.34 19.26 4.25C19.1 5.15 19.27 6.09 19.74 6.88C20.2 7.67 20.93 8.27 21.8 8.58V12.72H6.2V8.58C7.07 8.27 7.8 7.67 8.26 6.87C8.73 6.08 8.9 5.15 8.74 4.24C8.59 3.33 8.12 2.51 7.41 1.92C6.71 1.33 5.82 1 4.9 1C3.98 1 3.09 1.33 2.39 1.92C1.68 2.51 1.21 3.33 1.06 4.24C0.9 5.15 1.07 6.08 1.54 6.87C2 7.67 2.73 8.27 3.6 8.58V12.72C3.6 13.41 3.87 14.07 4.36 14.56C4.85 15.04 5.51 15.32 6.2 15.32H12.7V20.76C11.83 21.06 11.1 21.67 10.64 22.46C10.17 23.25 10 24.19 10.16 25.09C10.31 26 10.78 26.82 11.49 27.42C12.19 28.01 13.08 28.33 14 28.33C14.92 28.33 15.81 28.01 16.51 27.42C17.22 26.82 17.69 26 17.85 25.09C18 24.19 17.83 23.25 17.36 22.46C16.9 21.67 16.17 21.06 15.3 20.76V15.32H21.8C22.49 15.32 23.15 15.04 23.64 14.56C24.13 14.07 24.4 13.41 24.4 12.72V8.58C25.27 8.27 26 7.67 26.46 6.88C26.93 6.09 27.1 5.15 26.94 4.25C26.79 3.34 26.32 2.52 25.61 1.93C24.91 1.34 24.02 1.01 23.1 1.02ZM4.9 6.22C4.64 6.22 4.39 6.14 4.18 6C3.96 5.85 3.8 5.65 3.7 5.41C3.6 5.18 3.58 4.91 3.63 4.66C3.68 4.41 3.8 4.18 3.98 4C4.16 3.82 4.39 3.69 4.65 3.64C4.9 3.59 5.16 3.62 5.4 3.72C5.64 3.81 5.84 3.98 5.98 4.19C6.12 4.41 6.2 4.66 6.2 4.92C6.2 5.26 6.06 5.59 5.82 5.84C5.58 6.08 5.25 6.22 4.9 6.22ZM14 25.72C13.74 25.72 13.49 25.64 13.28 25.5C13.06 25.36 12.9 25.15 12.8 24.92C12.7 24.68 12.68 24.42 12.73 24.16C12.78 23.91 12.9 23.68 13.08 23.5C13.26 23.32 13.5 23.19 13.75 23.14C14 23.09 14.26 23.12 14.5 23.22C14.74 23.32 14.94 23.48 15.08 23.7C15.22 23.91 15.3 24.16 15.3 24.42C15.3 24.76 15.16 25.09 14.92 25.34C14.68 25.58 14.35 25.72 14 25.72ZM23.1 6.22C22.84 6.22 22.59 6.14 22.38 6C22.17 5.85 22 5.65 21.9 5.41C21.8 5.18 21.78 4.91 21.83 4.66C21.88 4.41 22 4.18 22.18 4C22.36 3.82 22.6 3.69 22.85 3.64C23.1 3.59 23.36 3.62 23.6 3.72C23.84 3.81 24.04 3.98 24.18 4.19C24.33 4.41 24.4 4.66 24.4 4.92C24.4 5.26 24.26 5.59 24.02 5.84C23.78 6.08 23.45 6.22 23.1 6.22Z'
        fill='currentColor'
        stroke='currentColor'
        strokeWidth='0.25'
      />
    </svg>
  )
}

export function CredentialIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <circle cx='8' cy='15' r='4' stroke='currentColor' strokeWidth='1.75' />
      <path d='M11.83 13.17L20 5' stroke='currentColor' strokeWidth='1.75' strokeLinecap='round' />
      <path
        d='M18 7l2 2'
        stroke='currentColor'
        strokeWidth='1.75'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M15 10l2 2'
        stroke='currentColor'
        strokeWidth='1.75'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function NoteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <rect
        x='4'
        y='3'
        width='16'
        height='18'
        rx='2.5'
        stroke='currentColor'
        strokeWidth='1.5'
        fill='none'
      />
      <path d='M15 3H18C18.55 3 19 3.45 19 4V7L15 3Z' fill='currentColor' />
      <path d='M8 11H15.5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
      <path d='M8 15H13' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  )
}

export function WorkflowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='30'
      height='30'
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <circle
        className='a'
        cx='12'
        cy='6'
        r='3'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <rect
        className='a'
        height='5'
        rx='2'
        width='8'
        x='2'
        y='16'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <rect
        className='a'
        height='5'
        rx='2'
        width='8'
        x='14'
        y='16'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        className='a'
        d='M6,16V14a2,2,0,0,1,2-2h8a2,2,0,0,1,2,2v2'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <line
        className='a'
        x1='12'
        x2='12'
        y1='9'
        y2='12'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function SignalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='29'
      height='35'
      viewBox='0 0 29 35'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M23.96 33.2C26.25 28.42 27.5 23.22 27.5 17.6C27.5 11.98 26.25 6.58 23.96 2M16.48 29.66C18.14 25.92 19.18 21.76 19.18 17.6C19.18 13.44 18.14 9.07 16.48 5.33M8.99 26.13C10.24 23.42 10.86 20.51 10.86 17.6C10.86 14.69 10.24 11.57 8.99 9.07M1.5 22.38C2.12 20.93 2.54 19.26 2.54 17.6C2.54 15.94 2.12 14.06 1.5 12.61'
        stroke='currentColor'
        strokeWidth='2.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function CalendarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='30'
      height='30'
      viewBox='0 0 30 30'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M21.5 4.89V2M8.5 4.89V2M2.36 9.22H27.64M2 12.17C2 9.12 2 7.59 2.63 6.42C3.2 5.38 4.08 4.55 5.15 4.04C6.39 3.44 8.01 3.44 11.24 3.44H18.76C21.99 3.44 23.61 3.44 24.85 4.04C25.93 4.56 26.82 5.4 27.37 6.42C28 7.59 28 9.12 28 12.18V19.27C28 22.33 28 23.85 27.37 25.02C26.8 26.06 25.92 26.9 24.85 27.41C23.61 28 21.99 28 18.76 28H11.24C8.01 28 6.39 28 5.15 27.4C4.08 26.9 3.2 26.06 2.63 25.02C2 23.85 2 22.32 2 19.27V12.17Z'
        stroke='currentColor'
        strokeWidth='2.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function MessagesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='30'
      height='30'
      viewBox='0 0 30 30'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M4.89 15C6.28 13.96 8 13.45 9.73 13.57C11.47 13.7 13.1 14.44 14.33 15.67C15.56 16.9 16.3 18.53 16.43 20.26C16.55 22 16.04 23.72 15 25.11M4.89 15C3.99 15.67 3.26 16.54 2.76 17.55C2.26 18.55 2 19.66 2 20.78C2 21.5 2.11 22.22 2.32 22.92C2.72 24.19 2.43 25.6 2.18 26.94C2.16 27.05 2.17 27.17 2.2 27.28C2.24 27.39 2.3 27.49 2.39 27.57C2.47 27.65 2.58 27.7 2.69 27.73C2.81 27.75 2.92 27.75 3.04 27.72C4.26 27.38 5.48 27.1 6.73 27.56C7.53 27.85 8.37 28 9.22 28C10.34 28 11.45 27.74 12.45 27.24C13.46 26.74 14.33 26.01 15 25.11M4.89 15C4.89 8.23 9.04 2 16.44 2C18.3 2 20.12 2.45 21.77 3.3C23.41 4.15 24.83 5.39 25.89 6.9C26.96 8.42 27.65 10.17 27.9 12C28.14 13.84 27.95 15.71 27.32 17.45C26.63 19.37 27.38 21.93 27.81 24.05C27.83 24.16 27.83 24.28 27.79 24.39C27.76 24.5 27.69 24.6 27.61 24.68C27.52 24.76 27.42 24.81 27.31 24.83C27.19 24.86 27.07 24.85 26.97 24.81C25.07 24.22 22.85 23.39 21.07 24.14C19.14 24.95 17.11 25.11 15 25.11'
        stroke='currentColor'
        strokeWidth='2.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function NotificationsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='30'
      height='33'
      viewBox='0 0 30 33'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M19.91 24.75H10.09M19.91 24.75H25.78C28.83 24.75 28.31 21.73 26.77 20.19C21.22 14.68 29.1 2 15 2C0.89 2 8.78 14.67 3.23 20.19C1.74 21.67 1.11 24.75 4.22 24.75H10.09M19.91 24.75C19.91 27.88 18.85 31.25 15 31.25C11.14 31.25 10.09 27.88 10.09 24.75'
        stroke='currentColor'
        strokeWidth='2.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function MailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='30'
      height='24'
      viewBox='0 0 30 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M2.36 5.83L11.77 12.11C13.07 12.97 13.71 13.4 14.42 13.57C15.04 13.72 15.68 13.72 16.3 13.57C17 13.4 17.65 12.97 18.95 12.11L28.36 5.83M8.83 21.72H21.89C24.15 21.72 25.28 21.72 26.15 21.28C26.91 20.89 27.53 20.27 27.92 19.51C28.36 18.65 28.36 17.52 28.36 15.25V7.97C28.36 5.71 28.36 4.57 27.92 3.71C27.53 2.95 26.91 2.33 26.15 1.94C25.28 1.5 24.15 1.5 21.89 1.5H8.83C6.56 1.5 5.43 1.5 4.57 1.94C3.81 2.33 3.19 2.95 2.8 3.71C2.36 4.57 2.36 5.71 2.36 7.97V15.25C2.36 17.52 2.36 18.65 2.8 19.51C3.19 20.27 3.8 20.89 4.57 21.28C5.43 21.72 6.56 21.72 8.83 21.72Z'
        stroke='currentColor'
        strokeWidth='2.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function MailServerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <rect
        x='3'
        y='4'
        width='18'
        height='16'
        rx='2'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M3 8L10.89 13.26C11.22 13.48 11.6 13.6 12 13.6C12.4 13.6 12.78 13.48 13.11 13.26L21 8'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <line
        x1='7'
        y1='16'
        x2='7'
        y2='16'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <line
        x1='10'
        y1='16'
        x2='10'
        y2='16'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
    </svg>
  )
}

export function CodeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='30'
      height='27'
      viewBox='0 0 30 27'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M23.26 6.83L23.64 7.2C26.54 10.11 28 11.56 28 13.37C28 15.18 26.54 16.63 23.64 19.54L23.26 19.91M18.04 2L11.95 24.74M6.73 6.83L6.36 7.2C3.45 10.11 2 11.56 2 13.37C2 15.18 3.45 16.63 6.36 19.54L6.73 19.91'
        stroke='currentColor'
        strokeWidth='2.6'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function ChartBarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='24'
      height='22'
      viewBox='0 0 24 22'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M14.4 0C14.91 0 15.41 0.21 15.77 0.59C16.13 0.96 16.33 1.47 16.33 2V6.5H21.6C22.11 6.5 22.61 6.71 22.97 7.09C23.33 7.46 23.53 7.97 23.53 8.5V19.2C23.53 19.73 23.33 20.24 22.97 20.61C22.61 20.99 22.11 21.2 21.6 21.2H2.4C1.89 21.2 1.39 20.99 1.03 20.61C0.67 20.24 0.47 19.73 0.47 19.2V12C0.47 11.47 0.67 10.96 1.03 10.59C1.39 10.21 1.89 10 2.4 10H7.67V2C7.67 1.47 7.87 0.96 8.23 0.59C8.59 0.21 9.09 0 9.6 0H14.4ZM14.4 2.4H9.6V19.2H14.4V2.4ZM21.6 8.9H16.33V19.2H21.6V8.9ZM7.67 12.5H2.4V19.2H7.67V12.5Z'
        fill='currentColor'
      />
    </svg>
  )
}

export function HubspotIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      role='img'
      viewBox='0 0 24 24'
      xmlns='http://www.w3.org/2000/svg'
      fill='currentColor'
    >
      <path d='M18.164 7.93V5.084a2.198 2.198 0 0 0 1.27-1.978v-.067A2.2 2.2 0 0 0 17.238.845h-.067a2.2 2.2 0 0 0-2.193 2.194v.067a2.196 2.196 0 0 0 1.27 1.978v2.85a6.21 6.21 0 0 0-2.974 1.31L5.443.515A2.5 2.5 0 1 0 4.3 4.664l-.123.013 7.728 6.013a6.182 6.182 0 0 0-1.043 3.45c0 1.336.43 2.605 1.157 3.62l-2.35 2.348a2.022 2.022 0 0 0-.585-.1 2.026 2.026 0 1 0 2.026 2.026 1.98 1.98 0 0 0-.1-.584l2.318-2.323A6.249 6.249 0 1 0 18.166 7.93Zm-.96 9.371a3.21 3.21 0 1 1 0-6.421 3.21 3.21 0 0 1 0 6.42z' />
    </svg>
  )
}

export function FirecrawlIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='30.778 11.238 575.239 571.826' xmlns='http://www.w3.org/2000/svg' {...props}>
      <path
        d='M301 63C299 91 303 122 298 149C295 158 289 165 283 169C274 172 266 170 261 167C253 176 248 183 244 191C230 226 226 263 226 301C216 310 203 317 192 310C179 295 175 277 174 259C161 273 153 288 146 304C141 321 138 336 137 352C140 372 145 388 152 402C161 421 174 435 187 449C181 462 165 453 157 450C158 454 161 458 165 461C195 490 231 500 268 509C240 494 211 471 195 442C179 413 172 378 180 344C191 353 200 362 211 364C223 365 232 361 236 353C247 274 299 214 323 143C322 136 327 140 329 142C354 165 367 191 375 218C387 254 381 294 379 329C393 345 413 334 424 329C429 342 432 352 429 362C427 378 417 388 413 400C422 407 433 403 440 400C432 423 419 442 404 460C383 483 358 501 335 512C379 502 420 491 449 459C443 458 427 464 428 452C443 437 464 423 472 403C482 383 485 362 484 339C482 307 472 280 458 254C459 267 452 276 445 284C434 289 426 279 424 272C415 247 424 220 418 198C415 179 405 165 397 150C370 114 336 86 303 64'
        fill='rgb(253,76,31)'
      />
      <path
        d='M324 141C303 214 249 273 244 354C235 359 229 364 223 366C205 367 193 357 182 347C180 350 179 353 180 357C178 374 178 390 182 403C185 421 193 434 200 448C212 465 227 480 243 491C258 500 269 513 285 512C284 508 257 485 252 468C241 450 235 433 233 414C241 415 254 420 263 412C260 387 265 363 273 343C281 323 293 306 310 295C317 289 324 285 330 282C328 307 328 331 329 355C330 368 332 379 338 389C358 394 376 384 388 370C383 386 377 401 371 415C376 414 381 411 385 408C383 421 380 431 376 441C366 467 356 491 334 510C358 499 381 483 400 461C418 442 430 423 440 403C432 404 421 410 413 404C414 386 428 377 427 360C429 349 428 340 424 332C413 336 404 341 392 339C386 338 381 334 379 330C380 292 385 248 371 214C366 195 358 180 349 165C341 155 333 145 323 140'
        fill='rgb(254,156,69)'
      />
      <path
        d='M330 284C309 293 289 311 279 332C267 356 261 383 265 411C256 420 242 418 235 412C237 438 245 459 258 479C269 493 281 507 295 513C288 495 265 472 265 446C272 447 281 454 288 444C296 425 303 407 309 388C317 406 321 427 336 443C346 449 358 446 363 438C355 464 348 489 334 511C344 501 352 491 357 480C370 457 379 435 385 412C380 411 376 416 371 418C376 401 382 386 387 371C379 382 369 388 358 391C348 394 337 392 334 383C324 353 328 316 330 285'
        fill='rgb(254,220,87)'
      />
      <path
        d='M311 389C303 407 297 426 289 445C282 454 273 450 268 445C267 472 285 492 302 512C299 514 297 514 294 514C297 514 299 514 301 514C314 515 325 512 334 513C341 495 355 467 362 443C357 446 351 448 344 447C337 446 334 441 330 438C320 422 316 406 311 391'
        fill='rgb(251,250,202)'
      />
      <path
        d='M187 163C188 181 167 187 164 203C158 215 158 228 159 241C172 233 183 221 188 209C193 194 192 178 188 166'
        fill='rgb(253,76,31)'
      />
    </svg>
  )
}

export function TranslateIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      {...props}
    >
      <path d='m5 8 6 6' />
      <path d='m4 14 6-6 2-3' />
      <path d='M2 5h12' />
      <path d='M7 2h1' />
      <path d='m22 22-5-10-5 10' />
      <path d='M14 18h6' />
    </svg>
  )
}

export function SlackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg' {...props}>
      <g>
        <path
          d='M53.84,161.32 C53.84,176.15 41.85,188.14 27.02,188.14 C12.19,188.14 0.2,176.15 0.2,161.32 C0.2,146.49 12.19,134.5 27.02,134.5 L53.84,134.5 L53.84,161.32 Z M67.25,161.32 C67.25,146.49 79.24,134.5 94.07,134.5 C108.9,134.5 120.89,146.49 120.89,161.32 L120.89,228.37 C120.89,243.2 108.9,255.19 94.07,255.19 C79.24,255.19 67.25,243.2 67.25,228.37 L67.25,161.32 Z'
          fill='#E01E5A'
        />
        <path
          d='M94.07,53.64 C79.24,53.64 67.25,41.65 67.25,26.82 C67.25,11.99 79.24,0 94.07,0 C108.9,0 120.89,11.99 120.89,26.82 L120.89,53.64 L94.07,53.64 Z M94.07,67.25 C108.9,67.25 120.89,79.24 120.89,94.07 C120.89,108.9 108.9,120.89 94.07,120.89 L26.82,120.89 C11.99,120.89 0,108.9 0,94.07 C0,79.24 11.99,67.25 26.82,67.25 L94.07,67.25 Z'
          fill='#36C5F0'
        />
        <path
          d='M201.55,94.07 C201.55,79.24 213.54,67.25 228.37,67.25 C243.2,67.25 255.19,79.24 255.19,94.07 C255.19,108.9 243.2,120.89 228.37,120.89 L201.55,120.89 L201.55,94.07 Z M188.14,94.07 C188.14,108.9 176.15,120.89 161.32,120.89 C146.49,120.89 134.5,108.9 134.5,94.07 L134.5,26.82 C134.5,11.99 146.49,0 161.32,0 C176.15,0 188.14,11.99 188.14,26.82 L188.14,94.07 Z'
          fill='#2EB67D'
        />
        <path
          d='M161.32,201.55 C176.15,201.55 188.14,213.54 188.14,228.37 C188.14,243.2 176.15,255.19 161.32,255.19 C146.49,255.19 134.5,243.2 134.5,228.37 L134.5,201.55 L161.32,201.55 Z M161.32,188.14 C146.49,188.14 134.5,176.15 134.5,161.32 C134.5,146.49 146.49,134.5 161.32,134.5 L228.57,134.5 C243.4,134.5 255.39,146.49 255.39,161.32 C255.39,176.15 243.4,188.14 228.57,188.14 L161.32,188.14 Z'
          fill='#ECB22E'
        />
      </g>
    </svg>
  )
}

export function GithubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} width='26' height='26' viewBox='0 0 26 26' xmlns='http://www.w3.org/2000/svg'>
      <path
        d='M13 0C11.29 0 9.6 0.34 8.03 0.99C6.45 1.64 5.01 2.6 3.81 3.81C1.37 6.25 0 9.55 0 13C0 18.75 3.73 23.62 8.89 25.35C9.54 25.45 9.75 25.05 9.75 24.7V22.5C6.15 23.28 5.38 20.76 5.38 20.76C4.78 19.25 3.94 18.85 3.94 18.85C2.76 18.04 4.03 18.07 4.03 18.07C5.33 18.16 6.02 19.41 6.02 19.41C7.15 21.39 9.06 20.8 9.8 20.49C9.92 19.64 10.26 19.07 10.62 18.75C7.74 18.42 4.71 17.3 4.71 12.35C4.71 10.91 5.2 9.75 6.05 8.83C5.92 8.5 5.46 7.15 6.18 5.4C6.18 5.4 7.27 5.04 9.75 6.72C10.78 6.44 11.9 6.29 13 6.29C14.11 6.29 15.22 6.44 16.25 6.72C18.73 5.04 19.83 5.4 19.83 5.4C20.54 7.15 20.09 8.5 19.95 8.83C20.8 9.75 21.29 10.91 21.29 12.35C21.29 17.32 18.25 18.41 15.35 18.73C15.82 19.14 16.25 19.93 16.25 21.14V24.7C16.25 25.05 16.46 25.47 17.12 25.35C22.28 23.61 26 18.75 26 13C26 11.29 25.66 9.6 25.01 8.03C24.36 6.45 23.4 5.01 22.19 3.81C20.99 2.6 19.55 1.64 17.97 0.99C16.4 0.34 14.71 0 13 0Z'
        fill='currentColor'
      />
    </svg>
  )
}

export function SerperIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='35.411 -19.109 628.098 628.098' xmlns='http://www.w3.org/2000/svg' {...props}>
      <path
        d='M324 38C356 37 389 36 417 47C452 56 484 72 509 94C539 118 561 145 577 176C593 205 601 238 606 271C610 343 590 403 552 452C528 482 499 507 467 523C438 539 404 547 372 552C297 556 235 534 184 492C133 449 103 392 93 330C93 292 89 255 102 224C112 189 128 158 149 132C194 78 255 46 322 38'
        fill='rgb(71,97,118)'
      />
      <path
        d='M326 39C286 43 250 55 217 75C185 94 156 120 137 150C100 204 87 266 95 336C107 402 142 462 198 502C249 538 309 556 378 551C415 545 449 533 477 516C511 497 535 472 557 445C592 393 611 333 605 265C595 196 563 140 511 95C484 73 452 57 419 48C390 38 359 38 327 39'
        fill='rgb(71,97,119)'
      />
      <path
        d='M342 40C407 42 465 61 513 103C541 126 562 155 576 184C592 217 600 251 600 288C602 357 579 416 535 465C510 493 478 515 445 528C416 541 385 546 352 546C284 548 225 523 178 481C130 436 103 379 96 313C94 244 113 186 151 138C179 103 209 80 245 64C276 50 307 44 340 41'
        fill='rgb(71,97,119)'
      />
      <path
        d='M344 42C309 44 277 51 247 64C209 81 180 103 153 136C114 186 95 244 96 312C104 379 131 435 177 480C225 522 284 547 351 546C385 545 416 540 443 528C478 514 509 492 533 466C578 416 601 357 600 289C599 251 591 217 576 187C561 156 541 127 515 105C466 63 409 44 346 41'
        fill='rgb(71,97,118)'
      />
      <path
        d='M327 81C378 78 423 89 462 114C511 144 546 196 557 248C567 306 559 363 530 406C498 457 448 492 395 503C338 513 282 506 239 477C192 450 156 402 143 351C126 296 137 235 163 190C198 130 258 89 325 82'
        fill='rgb(44,56,71)'
      />
      <path
        d='M329 83C260 89 199 129 165 189C138 235 127 296 144 349C157 401 193 449 237 475C282 505 338 512 393 503C448 491 497 457 529 408C558 363 566 306 557 250C545 196 511 145 464 116C424 91 380 79 330 82'
        fill='rgb(43,55,70)'
      />
      <path
        d='M334 87C381 83 423 94 458 117C510 148 544 201 554 258C562 317 551 370 521 412C487 460 440 491 385 500C331 507 281 499 241 473C191 444 157 394 145 339C136 284 143 227 171 186C207 129 265 91 332 87'
        fill='rgb(41,53,67)'
      />
      <path
        d='M335 88C267 90 208 129 173 184C144 227 137 284 145 338C158 393 191 443 240 471C281 498 331 506 384 500C439 490 487 459 519 413C550 370 561 317 554 259C543 201 509 149 460 119C424 96 383 85 337 88'
        fill='rgb(41,53,67)'
      />
      <path
        d='M347 166C361 164 373 169 387 168C412 180 437 193 447 221C449 232 443 243 434 248C403 245 398 204 365 207C338 206 315 210 297 228C294 238 289 257 303 260C337 280 382 276 417 292C436 300 448 314 455 330C457 349 462 373 449 385C435 408 413 418 391 427C361 429 328 436 304 421C280 413 260 392 250 370C246 356 255 343 268 343C293 360 316 398 356 389C382 390 409 380 416 357C389 295 298 335 260 276C246 256 248 233 258 214C279 184 309 167 346 167'
        fill='rgb(121,172,205)'
      />
      <path
        d='M349 168C312 167 280 183 259 212C249 233 247 256 260 274C299 334 390 294 422 354C409 381 382 391 357 389C316 399 293 361 272 342C255 344 247 356 251 368C260 391 280 412 302 420C328 435 361 428 389 428C412 417 434 407 447 386C461 373 456 349 456 332C428 270 351 289 304 262C288 258 293 239 295 229C314 209 338 204 363 204C398 203 403 244 431 249C443 242 448 232 449 222C436 193 412 181 388 172C374 170 363 166 350 167'
        fill='rgb(125,177,211)'
      />
      <path
        d='M349 169C386 169 425 185 441 220C444 231 441 240 432 243C409 237 402 209 380 206C347 200 314 201 293 226C290 238 286 256 297 262C332 283 375 281 411 295C431 304 446 317 452 337C455 360 452 383 434 396C415 415 391 421 366 426C338 430 316 422 295 413C276 402 261 385 254 366C254 353 261 343 275 348C290 381 325 398 360 394C388 395 411 382 420 360C425 342 413 334 404 327C359 304 298 318 265 276C253 254 255 235 261 214C280 187 314 173 346 170'
        fill='rgb(137,195,233)'
      />
      <path
        d='M349 171C316 173 281 187 263 214C256 235 254 254 266 273C300 316 359 304 401 325C413 333 426 342 422 358C412 382 388 396 363 395C326 399 290 382 278 348C262 345 254 353 253 365C261 384 277 401 292 411C316 421 338 429 365 426C390 420 415 414 432 398C451 383 454 360 453 338C445 317 430 305 413 296C375 282 332 284 299 264C285 257 288 239 291 228C304 212 319 205 336 202C378 193 403 213 423 244C438 244 443 232 441 222C425 186 388 171 352 170'
        fill='rgb(139,198,236)'
      />
    </svg>
  )
}

export function ConnectIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='24'
      height='24'
      viewBox='-2 -2 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M24 16C24 17.47 23.48 18.72 22.43 19.77C21.39 20.81 20.13 21.33 18.67 21.33H7.77C7.48 22.11 6.99 22.75 6.32 23.25C5.64 23.75 4.87 24 4 24C2.89 24 1.94 23.61 1.17 22.83C0.39 22.06 0 21.11 0 20C0 18.89 0.39 17.94 1.17 17.17C1.94 16.39 2.89 16 4 16C4.87 16 5.64 16.25 6.32 16.75C7 17.25 7.48 17.89 7.77 18.67H18.67C19.4 18.67 20.03 18.41 20.55 17.88C21.07 17.36 21.33 16.73 21.33 16C21.33 15.27 21.07 14.64 20.55 14.12C20.03 13.59 19.4 13.33 18.67 13.33L5.33 13.33C3.87 13.33 2.61 12.81 1.57 11.77C0.52 10.72 0 9.47 0 8C0 6.53 0.52 5.28 1.57 4.23C2.61 3.19 3.87 2.67 5.33 2.67H16.23C16.52 1.89 17.01 1.25 17.68 0.75C18.36 0.25 19.13 0 20 0C21.11 0 22.06 0.39 22.83 1.17C23.61 1.94 24 2.89 24 4C24 5.11 23.61 6.06 22.83 6.83C22.06 7.61 21.11 8 20 8C19.13 8 18.36 7.75 17.67 7.25C16.98 6.75 16.5 6.11 16.23 5.33H5.33C4.6 5.33 3.97 5.59 3.45 6.12C2.93 6.64 2.67 7.27 2.67 8C2.67 8.73 2.93 9.36 3.45 9.88C3.97 10.4 4.6 10.66 5.33 10.67L18.67 10.67C20.13 10.67 21.39 11.19 22.43 12.23C23.48 13.28 24 14.53 24 16ZM5.33 20C5.33 19.62 5.21 19.31 4.95 19.05C4.69 18.79 4.38 18.67 4 18.67C3.62 18.67 3.31 18.8 3.05 19.05C2.79 19.31 2.67 19.62 2.67 20C2.67 20.38 2.79 20.69 3.05 20.95C3.31 21.2 3.62 21.33 4 21.33C4.38 21.33 4.69 21.21 4.95 20.95C5.21 20.69 5.34 20.38 5.33 20ZM21.33 4C21.33 3.62 21.21 3.31 20.95 3.05C20.69 2.79 20.38 2.67 20 2.67C19.62 2.67 19.31 2.8 19.05 3.05C18.79 3.31 18.67 3.62 18.67 4C18.67 4.38 18.79 4.69 19.05 4.95C19.31 5.2 19.62 5.33 20 5.33C20.38 5.33 20.69 5.21 20.95 4.95C21.21 4.69 21.34 4.38 21.33 4Z'
        fill='currentColor'
      />
    </svg>
  )
}

export function NotionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='1em' height='1em' {...props}>
      <path
        d='M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z'
        fill='currentColor'
      />
    </svg>
  )
}

export function GmailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 48 48'
      width='96px'
      height='96px'
      {...props}
    >
      <path fill='#4caf50' d='M45,16.2l-5,2.75l-5,4.75L35,40h7c1.66,0,3-1.34,3-3V16.2z' />
      <path fill='#1e88e5' d='M3,16.2l3.61,1.71L13,23.7V40H6c-1.66,0-3-1.34-3-3V16.2z' />
      <polygon
        fill='#e53935'
        points='35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17'
      />
      <path
        fill='#c62828'
        d='M3,12.3V16.2l10,7.5V11.2L9.88,8.86C9.13,8.3,8.23,8,7.3,8h0C4.92,8,3,9.92,3,12.3z'
      />
      <path
        fill='#fbc02d'
        d='M45,12.3V16.2l-10,7.5V11.2l3.12-2.34C38.87,8.3,39.77,8,40.7,8h0 C43.08,8,45,9.92,45,12.3z'
      />
    </svg>
  )
}

export function GoogleDriveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 87.3 78'
      width='1em'
      height='1em'
      {...props}
    >
      <path
        d='m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z'
        fill='#0066da'
      />
      <path
        d='m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z'
        fill='#00ac47'
      />
      <path
        d='m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z'
        fill='#ea4335'
      />
      <path
        d='m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z'
        fill='#00832d'
      />
      <path
        d='m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z'
        fill='#2684fc'
      />
      <path
        d='m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z'
        fill='#ffba00'
      />
    </svg>
  )
}

export function GoogleSheetsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 48 48'
      width='96px'
      height='96px'
    >
      <path
        fill='#43a047'
        d='M37,45H11c-1.66,0-3-1.34-3-3V6c0-1.66,1.34-3,3-3h19l10,10v29C40,43.66,38.66,45,37,45z'
      />
      <path fill='#c8e6c9' d='M40 13L30 13 30 3z' />
      <path fill='#2e7d32' d='M30 13L40 23 40 13z' />
      <path
        fill='#e8f5e9'
        d='M31,23H17h-2v2v2v2v2v2v2v2h18v-2v-2v-2v-2v-2v-2v-2H31z M17,25h4v2h-4V25z M17,29h4v2h-4V29z M17,33h4v2h-4V33z M31,35h-8v-2h8V35z M31,31h-8v-2h8V31z M31,27h-8v-2h8V27z'
      />
    </svg>
  )
}

const GOOGLE_ICON_PNG_DATA_URI =
  'data:image/png;base64,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'

/**
 * Google's current "G" mark.
 *
 * Google publishes this logo only as a raster asset, so the official 200x204 transparent PNG is
 * embedded verbatim inside an SVG wrapper to keep the shared `SVGProps<SVGSVGElement>` icon API.
 * The wrapper's viewBox matches the artwork exactly, which bleeds to all four edges.
 *
 * @see https://developers.google.com/identity/branding-guidelines
 * @see https://developers.google.com/static/identity/images/g-logo.png
 */
export function GoogleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 200 204'
      width='24'
      height='24'
      fill='none'
    >
      <image href={GOOGLE_ICON_PNG_DATA_URI} x='0' y='0' width='200' height='204' />
    </svg>
  )
}

/** Instagram camera glyph rendered with the block's brand gradient background. */
export function InstagramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox='0 0 24 24'
      fill='currentColor'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
    >
      <path d='M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z' />
    </svg>
  )
}

export function InputIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='26'
      height='21'
      viewBox='0 0 26 21'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M2.6 20.8C1.89 20.8 1.27 20.55 0.76 20.04C0.26 19.53 0 18.92 0 18.2V15.6C0 15.23 0.12 14.92 0.37 14.67C0.62 14.43 0.93 14.3 1.3 14.3C1.67 14.3 1.98 14.42 2.23 14.67C2.48 14.92 2.6 15.23 2.6 15.6V18.2H23.4V2.6H2.6V5.2C2.6 5.57 2.48 5.88 2.23 6.13C1.98 6.38 1.67 6.5 1.3 6.5C0.93 6.5 0.62 6.37 0.37 6.13C0.12 5.88 0 5.57 0 5.2V2.6C0 1.89 0.25 1.27 0.76 0.76C1.27 0.26 1.89 0 2.6 0H23.4C24.12 0 24.73 0.25 25.24 0.76C25.75 1.27 26 1.89 26 2.6V18.2C26 18.92 25.75 19.53 25.24 20.04C24.73 20.55 24.12 20.8 23.4 20.8H2.6ZM13.23 11.7H1.3C0.93 11.7 0.62 11.58 0.37 11.33C0.13 11.08 0 10.77 0 10.4C0 10.03 0.12 9.72 0.37 9.47C0.62 9.22 0.93 9.1 1.3 9.1H13.23L11.44 7.35C11.18 7.11 11.06 6.81 11.07 6.45C11.08 6.09 11.2 5.79 11.44 5.53C11.7 5.27 12.01 5.13 12.37 5.12C12.72 5.11 13.03 5.23 13.29 5.49L17.29 9.49C17.55 9.75 17.68 10.05 17.68 10.4C17.68 10.75 17.55 11.05 17.29 11.31L13.29 15.31C13.03 15.57 12.72 15.7 12.37 15.7C12.01 15.7 11.7 15.57 11.44 15.31C11.2 15.05 11.08 14.74 11.07 14.38C11.05 14.02 11.18 13.72 11.44 13.46L13.23 11.7Z'
        fill='currentColor'
      />
    </svg>
  )
}

export function StartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='26'
      height='16'
      viewBox='0 0 26 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path
        d='M7.8 13C9.23 13 10.45 12.49 11.47 11.47C12.49 10.45 13 9.23 13 7.8C13 6.37 12.49 5.15 11.47 4.13C10.45 3.11 9.23 2.6 7.8 2.6C6.37 2.6 5.15 3.11 4.13 4.13C3.11 5.15 2.6 6.37 2.6 7.8C2.6 9.23 3.11 10.45 4.13 11.47C5.15 12.49 6.37 13 7.8 13ZM7.8 15.6C5.63 15.6 3.79 14.84 2.28 13.33C0.76 11.81 0 9.97 0 7.8C0 5.63 0.76 3.79 2.28 2.28C3.79 0.76 5.63 0 7.8 0C9.75 0 11.45 0.62 12.89 1.85C14.33 3.09 15.2 4.64 15.5 6.5H24.7C25.07 6.5 25.38 6.62 25.63 6.87C25.88 7.12 26 7.43 26 7.8C26 8.17 25.87 8.48 25.63 8.73C25.38 8.98 25.07 9.1 24.7 9.1H15.5C15.2 10.96 14.33 12.51 12.89 13.75C11.44 14.98 9.75 15.6 7.8 15.6Z'
        fill='currentColor'
      />
    </svg>
  )
}

export function LangChainIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'>
      <path
        fill='#7FC8FF'
        d='M7.531 15.976a7.534 7.534 0 000-10.651L2.206 0A7.537 7.537 0 000 5.326c0 1.996.794 3.913 2.206 5.325l5.325 5.325zM18.674 16.469a7.535 7.535 0 00-10.65 0l5.325 5.325a7.536 7.536 0 0010.651 0l-5.326-5.325zM2.218 21.782a7.536 7.536 0 005.326 2.206v-7.531H.012c0 1.996.795 3.914 2.206 5.325zM20.73 8.595a7.534 7.534 0 00-10.651.001l5.325 5.326 5.326-5.327z'
      />
    </svg>
  )
}

export function CrewAIIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'>
      <path
        fill='currentColor'
        d='M12.482.18C7.161 1.319 1.478 9.069 1.426 15.372c-.051 5.527 3.1 8.68 8.68 8.627 6.716-.05 14.259-6.87 12.09-10.9-.672-1.292-1.396-1.344-2.687-.207-1.602 1.395-1.654.31-.207-2.893 1.757-3.98 1.705-5.322-.31-7.544C17.03.388 14.962-.388 12.482.181Zm5.322 2.068c2.273 2.015 2.376 4.236.465 8.42-1.395 3.1-2.17 3.515-3.824 1.86-1.24-1.24-1.343-3.46-.258-6.044 1.137-2.635.982-3.1-.568-1.653-3.72 3.358-6.458 9.765-5.424 12.503.464 1.189.825 1.395 2.737 1.395 2.79 0 6.303-1.705 7.957-3.926 1.756-2.274 2.79-2.274 2.79-.052 0 3.875-6.459 8.627-11.625 8.627-6.251 0-9.351-4.752-7.491-11.47.878-2.995 4.443-7.904 7.077-9.66 3.255-2.17 5.684-2.17 8.164 0z'
      />
    </svg>
  )
}

export function DustIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 460 460' xmlns='http://www.w3.org/2000/svg'>
      <image
        href='data:image/jpeg;base64,/9j/2wCEAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDIBCQkJDAsMGA0NGDIhHCEyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMv/AABEIAcwBzAMBIgACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APIaKKK2MwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK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KKACiiigAooooAVVZ2CqCWY4AHc132gaIumQGSUBrmQfMf7o9BWF4S0/z717x1ykIwuf7x/wH8xXbV72VYVW9tLfp/meZja7v7NfMKKKK9o84KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA4LxX/yHG/65rWJW34r/AOQ43/XNaxK+Qxf8efqz38P/AAo+gUUUVzGoUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUDPRPD1t9m0S2GPmkXzD755/litSq9gMadagdBEn8hVivtKMVGnGK6I+dqO82wooorQgKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA4LxX/AMhxv+ua1iVt+K/+Q43/AFzWsSvkMX/Hn6s9/D/wo+gUUUVzGoUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAelaNMJ9GtHBz+6Cn6jg/yq9XLeD78NFLYOfmU+Yn07j8/511NfX4SqqtGMvI8GvBwqNBRRRXSYhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAHBeK/8AkON/1zWsStvxX/yHG/65rWJXyGL/AI8/Vnv4f+FH0CiiiuY1CiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooGFFFFABRRRQBPZXktheR3MON6HoehHcV6RYXsOoWiXEJyrDkd1PcGvMKvaXqtxpU++I7kb78ZPDf8A1/evQwGN+ry5ZfC/wOTFYb2qutz0qiqGnaxaamn7mTEmOY24Yf41fr6aE4zXNF3R40ouLtLQKKKKoQUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAHBeK/wDkON/1zWsStvxX/wAhxv8ArmtYlfIYz+PP1Z7+H/hR9AooormNQooooAKKKKACiiigAooooAKKKKACiiigAooooAK9D0T4WPrOi2mojWFhFwm/y/s+7b+O6vPK+i/A/wDyJOk/9cB/M1tRipOzMMROUIpxOG/4UxJ/0HV/8Bf/ALOj/hTEn/QdX/wF/wDs69Zoro9jDscf1ip3PJv+FMSf9B1f/AX/AOzo/wCFMSf9B1f/AAF/+zr1mij2MOwfWKnc8m/4UxJ/0HV/8Bf/ALOj/hTEn/QdX/wF/wDs69Zoo9jDsH1ip3PJ1+DUyOGTXwrA5BFsQR/4/W3aeA9Vt1Cya9FOv/TS0OfzD13tFa070neDsROpKfxanJJ4Nmx89+hPtEf8aiuPCF4qE29xBI3YSZQfmAa7Kiun65W/m/Iy5I9jyXV4df0VTJPoLywjky283mKB6nC5A+orm/8AhNV/58D/AN/v/rV79XJ+JfAGj+II5ZUhW1v2yRcRDGW/2h0P8/es5YvFbxn+C/yNqao7Tj+Z5b/wmq/8+B/7+/8A1qP+E1X/AJ8D/wB/f/rVhaxot/oN+9nqEBjkXoequPVT3FZ9czzLFL7X4L/I7FhKDV0vxZ1v/Car/wA+B/7+/wD1qP8AhNV/58D/AN/f/rVyVFH9pYr+b8F/kH1Oj/L+LOt/4TVf+fA/9/f/AK1H/Car/wA+B/7+/wD1q5Kij+0sV/N+C/yD6nR/l/FnfaFr41zWrfThbGEzbv3m/djClumB6V2v/COt/wA/I/74/wDr15f4C/5HXT/+2n/otq9tr5XPOJMzwuIUKNSytfaL6vuvI9jL8owdak5Thd37vy8zC/4R1v8An5H/AHx/9ej/AIR1v+fkf98f/Xrdorxv9b85/wCf3/ksf8jv/sLAfyfi/wDMwv8AhHW/5+R/3x/9ej/hHW/5+R/3x/8AXrdoo/1vzn/n9/5LH/IP7CwH8n4v/Mwv+Edb/n5H/fH/ANej/hHW/wCfkf8AfH/163aKP9b85/5/f+Sx/wAg/sLAfyfi/wDMwv8AhHW/5+R/3x/9ej/hHW/5+R/3x/8AXrdop/635z/z+/8AJY/5B/YWA/k/F/5nn/iq6/4Rj7JuT7T9o39Ds27dv1z96uc/4TVf+fA/9/f/AK1bfxX66R/22/8AZK83r7HKs6xuIwcKtSd279F3a7HhYzL8NTryhCOi8329Trf+E1X/AJ8D/wB/f/rUf8Jqv/Pgf+/v/wBauSor0f7SxX834L/I5fqdH+X8Wdb/AMJqv/Pgf+/v/wBaj/hNV/58D/39/wDrVyVFH9pYr+b8F/kH1Oj/AC/izrf+E1X/AJ8D/wB/f/rUf8Jqv/Pgf+/v/wBauSoo/tLFfzfgv8g+p0f5fxZ1v/Car/z4H/v7/wDWo/4TVf8AnwP/AH9/+tXJUUf2liv5vwX+QfU6P8v4svatqI1S+NyIvLyoXbuz0qjRRXFObnJyluzojFRSigoooqRhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAV9F+B/+RJ0n/rgP5mvnSvovwP8A8iTpP/XAfzNdGH+JnLi/hR0FFFFdZwBRRRQAUUUUAFFFFABRRRQAUUUUAYfivw3B4n0WSykISZTvglIzsb/A9DXzxfWVxpt/PZXUZSeByjr7j+lfUdeQfF7RBBfWutRL8twPJm/3gPlP4jI/4DXPXhdcx1YWo0+RnmdFFFch3hRRRQB0fgL/AJHXT/8Atp/6Lavba8S8Bf8AI66f/wBtP/RbV7bXw/Ev+9x/wr82fQ5T/Afr+iCiiivnj1AooooAKKKKACiiimB5v8V+ukf9tv8A2SvN69I+K/XSP+23/sleb1+hZF/yL6fz/wDSmfL5j/vMvl+SCiiivWOIKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK+i/A/8AyJOk/wDXAfzNfOlfRfgf/kSdJ/64D+Zrow/xM5cX8KOgooorrOAKKKKACiiigAooooAKKKKACiiigArl/iFYrfeCNRUrloUEyn02kE/pkfjXUVkeKyB4R1gt0+xTfnsOKmavFlQdpJnzXRRRXnHrhRRRQB0fgL/kddP/AO2n/otq9trxLwF/yOun/wDbT/0W1e218PxL/vcf8K/Nn0OU/wAB+v6IKKKK+ePUCiiigAooooAKKKKYHm/xX66R/wBtv/ZK83r0j4r9dI/7bf8Asleb1+hZF/yL6fz/APSmfL5j/vMvl+SCiiivWOIKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK+i/A/wDyJOk/9cB/M186V9F+B/8AkSdJ/wCuA/ma6MP8TOXF/CjoKKKK6zgCiiigAooooAKKKKACiiigAooooAK5H4lagLDwTdruxJclYE98nJ/8dBrrq8U+LGuC/wBei0yF8w2S/Pj/AJ6N1/IYH1zWdWVos1oQ5po8/ooorgPUCiiigDo/AX/I66f/ANtP/RbV7bXiXgL/AJHXT/8Atp/6Lavba+H4l/3uP+Ffmz6HKf4D9f0QUUUV88eoFFFFABRRRQAUUUUwPN/iv10j/tt/7JXm9ekfFfrpH/bb/wBkrzev0LIv+RfT+f8A6Uz5fMf95l8vyQUUUV6xxBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABX0X4H/AORJ0n/rgP5mvnSvovwP/wAiTpP/AFwH8zXRh/iZy4v4UdBRRRXWcAUUUUAFFFFABRRRQAUUUUAFFRXFzBaQtNczxwxLyzyMFUfia8+8UfFOys4nttDxdXJGPPI/dx+4/vH9Pr0qZTUdy4U5Tdoo2fHfjCPwzphit3Q6nOMQoedg7uR6enqfoa8DkkeaV5ZHZ5HYszMckk9Safc3Vxe3L3N1M800hyzyNkk1FXFUm5u56NKkqa8wooorM1CiiigDo/AX/I66f/20/wDRbV7bXiXgL/kddP8A+2n/AKLavba+H4l/3uP+Ffmz6HKf4D9f0QUUUV88eoFFFFABRRRQAUUUUwPN/iv10j/tt/7JXm9ekfFfrpH/AG2/9krzev0LIv8AkX0/n/6Uz5fMf95l8vyQUUUV6xxBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABXV6b8RNf0rToLG1ktxBAu1A0QJx9a5SiqUmthSipbo7X/hanif8A5623/fgUf8LU8T/89bb/AL8CuKop+0n3I9lT7Ha/8LU8T/8APW2/78Cj/hanif8A5623/fgVxVFHtJ9w9lT7Ha/8LU8T/wDPW2/78Cj/AIWp4n/5623/AH4FcVRR7SfcPZU+x2v/AAtTxP8A89bb/vwKP+FqeJ/+ett/34FcVRR7SfcPZU+x2v8AwtTxP/z1tv8AvwKguPiZ4pnUqL6OIH/nnAgP5kGuRoo9pLuP2UOxbv8AVL/VZRJf3s9y46GVy2PpnpVSiioLStsFFFFABRRRQAUUUUAW9M1G40nUYr61KieLO0sMjkEHj6E10X/Cx/EH/PS3/wC/IrkqK5q2Dw9aXNVgm/NGsK9SmrQk0db/AMLH8Qf89Lf/AL8ij/hY/iD/AJ6W/wD35FclRWX9mYP/AJ9L7jT63X/nf3nW/wDCx/EH/PS3/wC/Io/4WP4g/wCelv8A9+RXJUUf2Zg/+fS+4Prdf+d/edb/AMLH8Qf89Lf/AL8ij/hY/iD/AJ6W/wD35FclRR/ZmD/59L7g+t1/53951v8AwsfxB/z0t/8AvyKP+Fj+IP8Anpb/APfkVyVFH9mYP/n0vuD63X/nf3mtrfiPUPEHkfb2jPkbtmxNv3sZ/kKyaKK66VKFKKhTVkuhhKcpvmk7sKKKKskKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP//Z'
        width='460'
        height='460'
      />
    </svg>
  )
}

export function OpenClawIcon(props: SVGProps<SVGSVGElement>) {
  const id = useId()
  const gid = (name: string) => `openclaw_${name}_${id}`

  return (
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512' {...props}>
      <linearGradient
        id={gid('a')}
        x1='-694.696'
        x2='-690.195'
        y1='793.943'
        y2='789.442'
        gradientTransform='matrix(90 0 0 -100 62582 79427)'
        gradientUnits='userSpaceOnUse'
      >
        <stop offset='0' stopColor='#ff4d4d' />
        <stop offset='1' stopColor='#991b1b' />
      </linearGradient>
      <path
        fill={`url(#${gid('a')})`}
        d='M256 39.3c-135 0-202.5 112.5-202.5 202.5s67.5 180 135 202.5v45h45v-45s22.5 9 45 0v45h45v-45c67.5-22.5 135-112.5 135-202.5S391 39.3 256 39.3'
      />
      <linearGradient
        id={gid('b')}
        x1='-672.565'
        x2='-668.064'
        y1='777.351'
        y2='772.849'
        gradientTransform='matrix(23.0719 0 0 -21.7808 15519.697 17119.95)'
        gradientUnits='userSpaceOnUse'
      >
        <stop offset='0' stopColor='#ff4d4d' />
        <stop offset='1' stopColor='#991b1b' />
      </linearGradient>
      <path
        fill={`url(#${gid('b')})`}
        d='M76 196.8c-67.5-22.5-90 22.5-67.5 67.5s67.5 22.5 90-22.5c13.5-31.5 0-45-22.5-45'
      />
      <linearGradient
        id={gid('c')}
        x1='-658.669'
        x2='-654.168'
        y1='777.486'
        y2='772.985'
        gradientTransform='matrix(23.0719 0 0 -21.7808 15610.38 17119.95)'
        gradientUnits='userSpaceOnUse'
      >
        <stop offset='0' stopColor='#ff4d4d' />
        <stop offset='1' stopColor='#991b1b' />
      </linearGradient>
      <path
        fill={`url(#${gid('c')})`}
        d='M436 196.8c67.5-22.5 90 22.5 67.5 67.5s-67.5 22.5-90-22.5c-13.5-31.5 0-45 22.5-45'
      />
      <path
        fill='#ff4d4d'
        d='M188.5 66.3c-1.2 0-2.3-.4-3.2-1.3-27.8-27.8-49.3-38.5-62-30.8-2.1 1.3-4.9.6-6.2-1.5s-.6-4.9 1.5-6.2c17.2-10.3 41.1.2 73 32.2 1.8 1.8 1.8 4.6 0 6.4-.8.7-2 1.2-3.1 1.2M326.7 65c27.8-27.8 49.3-38.5 62-30.8 2.1 1.3 4.9.6 6.2-1.5s.6-4.9-1.5-6.2c-17.2-10.3-41.1.2-73 32.2-1.8 1.8-1.8 4.6 0 6.4.9.9 2 1.3 3.2 1.3s2.2-.6 3.1-1.4'
      />
      <path
        fill='#050810'
        d='M188.5 124.8c14.9 0 27 12.1 27 27s-12.1 27-27 27-27-12.1-27-27 12.1-27 27-27m135 0c14.9 0 27 12.1 27 27s-12.1 27-27 27-27-12.1-27-27 12.1-27 27-27'
      />
      <path
        fill='#00e5cc'
        d='M193 138.3c5 0 9 4 9 9s-4 9-9 9-9-4-9-9 4-9 9-9m135 0c5 0 9 4 9 9s-4 9-9 9-9-4-9-9 4-9 9-9'
      />
    </svg>
  )
}

export function CloudflareIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns='http://www.w3.org/2000/svg' viewBox='16.843 67.616 478.418 356.61'>
      <path
        fill='#f38020'
        d='M331 326c11-26-4-38-19-38l-148-2c-4 0-4-6 1-7l150-2c17-1 37-15 43-33 0 0 10-21 9-24a97 97 0 0 0-187-11c-38-25-78 9-69 46-48 3-65 46-60 72 0 1 1 2 3 2h274c1 0 3-1 3-3z'
      />
      <path
        fill='#faae40'
        d='M381 224c-4 0-6-1-7 1l-5 21c-5 16 3 30 20 31l32 2c4 0 4 6-1 7l-33 1c-36 4-46 39-46 39 0 2 0 3 2 3h113l3-2a81 81 0 0 0-78-103'
      />
    </svg>
  )
}

export function OpenAIIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='800px'
      height='800px'
      viewBox='0 0 24 24'
      role='img'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M22.28 9.82a5.98 5.98 0 0 0-.516-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .743 7.1 5.98 5.98 0 0 0 .511 4.91 6.05 6.05 0 0 0 6.51 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.748-7.07zm-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.142-.08 4.78-2.76a.795.79 0 0 0 .393-.681v-6.74l2.02 1.17a.71.07 0 0 1 .38.05v5.58a4.5 4.5 0 0 1-4.49 4.49zm-9.66-4.13a4.47 4.47 0 0 1-.535-3.01l.142.09 4.78 2.76a.771.77 0 0 0 .781 0l5.84-3.37v2.33a.804.08 0 0 1-.332.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.97V11.6a.766.77 0 0 0 .388.68l5.81 3.35-2.02 1.17a.757.08 0 0 1-.071 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.87zm16.6 3.86L13.1 8.36 15.12 7.2a.757.08 0 0 1 .071 0l4.83 2.79a4.49 4.49 0 0 1-.676 8.1v-5.68a.79.79 0 0 0-.407-.667zm2.01-3.02l-.142-.085-4.77-2.78a.776.78 0 0 0-.785 0L9.41 9.23V6.9a.662.07 0 0 1 .028-.061l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86l-2.02-1.16a.804.08 0 0 1-.038-.057V6.07a4.5 4.5 0 0 1 7.38-3.45l-.142.08L8.7 5.46a.795.79 0 0 0-.393.68zm1.1-2.37l2.6-1.5 2.61 1.5v3l-2.6 1.5-2.61-1.5Z'
        fill='currentColor'
      />
    </svg>
  )
}

export function ExaAIIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='252'
      height='304'
      viewBox='0 0 252 304'
      fill='none'
      role='img'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M4.82 0.75C5.94 0.75 5.94 0.75 7.09 0.75C7.95 0.75 8.81 0.74 9.69 0.74C10.64 0.74 11.59 0.75 12.57 0.75C13.58 0.75 14.58 0.75 15.62 0.75C19.01 0.74 22.4 0.75 25.79 0.76C28.22 0.76 30.64 0.75 33.06 0.75C38.97 0.75 44.88 0.75 50.79 0.76C57.66 0.77 64.54 0.77 71.41 0.77C83.67 0.77 95.94 0.78 108.2 0.79C120.11 0.81 132.02 0.82 143.93 0.81C144.67 0.81 145.4 0.81 146.16 0.81C146.89 0.81 147.62 0.81 148.38 0.81C161.92 0.81 175.46 0.82 189.01 0.83C193.8 0.83 198.6 0.83 203.4 0.83C209.85 0.83 216.3 0.84 222.75 0.85C225.12 0.85 227.5 0.85 229.87 0.85C233.1 0.85 236.33 0.86 239.55 0.87C240.51 0.86 241.46 0.86 242.44 0.86C248.89 0.89 248.89 0.89 250 2C252.1 17.51 252.1 17.51 247.83 23.73C245.55 26.54 243.02 29.08 240.42 31.59C238.38 33.62 236.64 35.85 234.88 38.13C231.09 42.9 227.24 47.62 223.37 52.33C222.38 53.53 221.4 54.73 220.41 55.94C214.43 63.23 208.44 70.51 202.31 77.69C198.11 82.61 194.1 87.66 190.13 92.76C186.1 97.93 181.88 102.93 177.63 107.91C173.67 112.54 169.84 117.28 166 122C164.5 123.83 163 125.67 161.5 127.5C159.2 130.31 156.91 133.12 154.61 135.93C153.83 136.88 153.05 137.83 152.25 138.81C151.51 139.72 150.78 140.63 150.02 141.56C148.81 143.02 147.58 144.46 146.29 145.85C143.62 148.63 143.62 148.63 143.08 152.29C144.29 155.84 146.41 158.21 148.88 160.94C149.88 162.09 150.89 163.24 151.89 164.39C152.66 165.28 152.66 165.28 153.45 166.18C155.96 169.13 158.32 172.19 160.69 175.25C164.27 179.87 167.99 184.29 171.92 188.61C174.48 191.55 176.86 194.61 179.25 197.69C183.1 202.66 187.07 207.5 191.19 212.25C195.14 216.82 199 221.44 202.75 226.18C206.38 230.72 210.09 235.2 213.79 239.68C217.1 243.7 220.4 247.72 223.69 251.75C226.93 255.73 230.24 259.65 233.56 263.56C238.15 268.96 242.64 274.42 247 280C247.85 280.84 247.85 280.84 248.71 281.7C250.78 285.39 250.31 289.11 250.19 293.25C250.17 294.09 250.16 294.93 250.15 295.8C250.11 297.87 250.06 299.93 250 302C247.72 303.14 246.47 303.13 243.93 303.13C243.08 303.13 242.22 303.14 241.34 303.14C240.39 303.14 239.45 303.14 238.47 303.13C237.47 303.14 236.47 303.14 235.44 303.14C232.06 303.15 228.69 303.15 225.31 303.15C222.9 303.15 220.49 303.15 218.08 303.15C212.2 303.16 206.32 303.17 200.44 303.17C195.66 303.17 190.88 303.17 186.1 303.17C172.57 303.18 159.03 303.19 145.5 303.19C144.77 303.19 144.04 303.19 143.28 303.19C142.55 303.19 141.82 303.19 141.07 303.19C129.21 303.19 117.36 303.19 105.5 303.21C93.34 303.22 81.18 303.23 69.02 303.23C62.19 303.23 55.36 303.23 48.52 303.24C42.1 303.25 35.68 303.25 29.26 303.25C26.89 303.24 24.53 303.25 22.17 303.25C18.95 303.26 15.74 303.26 12.53 303.25C11.58 303.25 10.64 303.26 9.66 303.26C8.81 303.26 7.95 303.25 7.07 303.25C6.32 303.25 5.58 303.25 4.82 303.25C3 303 3 303 1 301C0.75 298.84 0.75 298.84 0.75 296.11C0.74 295.07 0.74 294.02 0.73 292.95C0.74 291.8 0.74 290.65 0.75 289.46C0.74 288.24 0.74 287.02 0.74 285.77C0.73 282.38 0.73 278.99 0.74 275.6C0.74 271.95 0.74 268.3 0.73 264.65C0.72 257.49 0.72 250.34 0.73 243.18C0.73 237.37 0.73 231.55 0.73 225.74C0.73 224.91 0.73 224.09 0.73 223.23C0.73 221.56 0.73 219.88 0.73 218.2C0.72 202.45 0.73 186.7 0.74 170.94C0.75 157.42 0.75 143.89 0.74 130.36C0.73 114.67 0.72 98.97 0.73 83.28C0.73 81.61 0.73 79.93 0.73 78.26C0.73 77.03 0.73 77.03 0.73 75.77C0.74 69.96 0.73 64.15 0.73 58.34C0.72 51.26 0.72 44.19 0.73 37.11C0.74 33.5 0.74 29.88 0.73 26.27C0.73 22.36 0.74 18.45 0.75 14.54C0.74 13.39 0.74 12.24 0.73 11.05C0.74 10.01 0.74 8.97 0.75 7.89C0.75 6.99 0.75 6.09 0.75 5.16C1.08 2.33 1.93 1.15 4.82 0.75ZM39 25C40.5 28.01 41.66 29.99 43.72 32.5C44.26 33.16 44.79 33.81 45.34 34.48C45.91 35.17 46.48 35.85 47.06 36.56C47.65 37.28 48.24 38 48.84 38.73C50.56 40.83 52.28 42.91 54 45C55.5 46.83 57 48.67 58.5 50.5C59.2 51.36 59.91 52.22 60.63 53.11C74.85 70.49 74.85 70.49 81.44 78.94C86.65 85.62 92.04 92.16 97.45 98.7C106.5 109.65 115.41 120.68 124 132C126.94 131.67 127.95 131.05 130.04 128.88C130.75 127.97 131.46 127.06 132.19 126.13C132.98 125.13 133.77 124.12 134.58 123.09C135.38 122.07 136.18 121.05 137 120C138.45 118.2 139.91 116.41 141.38 114.63C142.11 113.72 142.85 112.82 143.61 111.89C146.24 108.71 148.9 105.57 151.56 102.44C155.36 97.97 159.07 93.45 162.71 88.86C167.53 82.84 172.46 76.92 177.37 70.98C181.65 65.78 185.91 60.57 190.16 55.34C193.83 50.84 197.53 46.37 201.3 41.95C209.03 34.26 209.03 34.26 213 25C155.58 25 98.16 25 39 25ZM25 48C25 78.36 25 108.72 25 140C49.42 140 73.84 140 99 140C97.17 135.43 95.23 132.63 92.06 129.06C88.15 124.55 84.35 119.97 80.69 115.25C75.9 109.09 70.96 103.05 65.98 97.04C62.31 92.6 58.69 88.14 55.1 83.63C51.81 79.51 48.48 75.42 45.15 71.34C42.2 67.72 39.27 64.09 36.34 60.45C35.75 59.71 35.16 58.98 34.55 58.22C33.41 56.81 32.27 55.39 31.14 53.96C28.5 50.49 28.5 50.49 25 48ZM25 164C25 194.36 25 224.72 25 256C29.05 252.76 31.89 249.85 34.94 245.81C39.15 240.33 43.47 234.95 47.88 229.63C49.07 228.18 50.26 226.74 51.45 225.3C52.04 224.59 52.63 223.87 53.24 223.14C60.6 214.21 67.86 205.21 74.97 196.08C78.1 192.09 81.33 188.22 84.63 184.38C93.89 174.95 93.89 174.95 99 164C74.58 164 50.16 164 25 164ZM124 172C122.3 173.68 122.3 173.68 120.63 176C119.92 176.91 119.22 177.83 118.5 178.77C118.1 179.28 117.71 179.79 117.3 180.32C114.82 183.51 112.25 186.62 109.69 189.75C105.53 194.85 101.42 199.99 97.38 205.19C93.41 210.27 89.31 215.22 85.12 220.12C81.4 224.48 77.86 228.96 74.34 233.48C69.99 239.05 65.5 244.5 60.99 249.95C57.25 254.48 53.54 259.04 49.89 263.65C46.88 267.4 43.78 271.07 40.69 274.75C38.8 276.8 38.8 276.8 39 279C96.42 279 153.84 279 213 279C211.09 274.23 208.91 271.29 205.56 267.56C201.39 262.81 197.36 258 193.5 253C189.8 248.21 185.97 243.57 182 239C177.55 233.87 173.3 228.62 169.15 223.25C165.88 219.06 162.48 215.01 159 211C154.55 205.88 150.32 200.64 146.16 195.27C142.25 190.25 138.15 185.42 133.97 180.62C131.99 178.33 130.06 176.09 128.34 173.6C127.9 173.07 127.46 172.55 127 172C126.01 172 125.02 172 124 172Z'
        fill='currentColor'
      />
    </svg>
  )
}

export function AirtableIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='800px'
      height='800px'
      viewBox='0 -20.5 256 256'
      version='1.1'
      xmlns='http://www.w3.org/2000/svg'
      xmlnsXlink='http://www.w3.org/1999/xlink'
      preserveAspectRatio='xMidYMid'
    >
      <g>
        <path
          d='M114.26,2.7 L18.86,42.18 C13.56,44.37 13.61,51.91 18.95,54.02 L114.75,92.01 C123.16,95.35 132.54,95.35 140.95,92.01 L236.75,54.02 C242.09,51.91 242.15,44.37 236.84,42.18 L141.44,2.7 C132.74,-0.9 122.96,-0.9 114.26,2.7'
          fill='#FFBF00'
        />
        <path
          d='M136.35,112.76 L136.35,207.66 C136.35,212.17 140.9,215.26 145.1,213.6 L251.84,172.17 C254.28,171.2 255.88,168.85 255.88,166.22 L255.88,71.32 C255.88,66.81 251.33,63.72 247.13,65.38 L140.38,106.82 C137.95,107.78 136.35,110.14 136.35,112.76'
          fill='#26B5F8'
        />
        <path
          d='M111.42,117.65 L79.74,132.95 L76.53,134.5 L9.65,166.55 C5.41,168.59 0,165.5 0,160.79 L0,71.72 C0,70.02 0.87,68.55 2.05,67.44 C2.53,66.95 3.09,66.54 3.66,66.23 C5.26,65.27 7.54,65.01 9.48,65.78 L110.89,105.96 C116.05,108 116.45,115.23 111.42,117.65'
          fill='#ED3049'
        />
        <path
          d='M111.42,117.65 L79.74,132.95 L2.05,67.44 C2.53,66.95 3.09,66.54 3.66,66.23 C5.26,65.27 7.54,65.01 9.48,65.78 L110.89,105.96 C116.05,108 116.45,115.23 111.42,117.65'
          fillOpacity='0.25'
          fill='#000000'
        />
      </g>
    </svg>
  )
}

export function GoogleDocsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 48 48'
      width='96px'
      height='96px'
    >
      <path
        fill='#2196f3'
        d='M37,45H11c-1.66,0-3-1.34-3-3V6c0-1.66,1.34-3,3-3h19l10,10v29C40,43.66,38.66,45,37,45z'
      />
      <path fill='#bbdefb' d='M40 13L30 13 30 3z' />
      <path fill='#1565c0' d='M30 13L40 23 40 13z' />
      <path fill='#e3f2fd' d='M15 23H33V25H15zM15 27H33V29H15zM15 31H33V33H15zM15 35H25V37H15z' />
    </svg>
  )
}

export function GoogleCalendarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      version='1.1'
      xmlns='http://www.w3.org/2000/svg'
      xmlnsXlink='http://www.w3.org/1999/xlink'
      x='0px'
      y='0px'
      viewBox='0 0 200 200'
      enableBackground='new 0 0 200 200'
      xmlSpace='preserve'
    >
      <g>
        <g transform='translate(3.75 3.75)'>
          <path
            fill='#FFFFFF'
            d='M148.88,43.62l-47.37-5.26l-57.89,5.26L38.35,96.25l5.26,52.63l52.63,6.58l52.63-6.58
			l5.26-53.95L148.88,43.62z'
          />
          <path
            fill='#1A73E8'
            d='M65.21,125.28c-3.93-2.66-6.66-6.54-8.14-11.67l9.13-3.76c0.83,3.16,2.28,5.61,4.34,7.34
			c2.05,1.74,4.55,2.59,7.47,2.59c2.99,0,5.55-0.91,7.7-2.72s3.22-4.13,3.22-6.93c0-2.87-1.13-5.21-3.39-7.03
			s-5.11-2.72-8.5-2.72h-5.28v-9.04H76.5c2.92,0,5.38-0.79,7.38-2.37c2-1.58,3-3.74,3-6.49
			c0-2.45-0.89-4.39-2.68-5.85s-4.05-2.2-6.8-2.2c-2.68,0-4.82,0.71-6.39,2.15s-2.72,3.2-3.45,5.28
			l-9.04-3.76c1.2-3.39,3.4-6.39,6.62-8.99c3.22-2.59,7.34-3.89,12.34-3.89c3.7,0,7.03,0.71,9.97,2.15
			c2.95,1.43,5.26,3.42,6.93,5.95c1.67,2.54,2.5,5.38,2.5,8.54c0,3.22-0.78,5.95-2.33,8.18
			c-1.55,2.24-3.46,3.95-5.72,5.15v0.54c2.99,1.25,5.42,3.16,7.34,5.72c1.91,2.57,2.87,5.63,2.87,9.21
			s-0.91,6.78-2.72,9.58c-1.82,2.8-4.33,5.01-7.51,6.62c-3.2,1.61-6.79,2.42-10.78,2.42
			C73.41,129.26,69.15,127.93,65.21,125.28z'
          />
          <path
            fill='#1A73E8'
            d='M121.25,79.96l-9.97,7.25l-5.01-7.6l17.99-12.97h6.9v61.2h-9.89L121.25,79.96z'
          />
          <path
            fill='#EA4335'
            d='M148.88,196.25l47.37-47.37l-23.68-10.53l-23.68,10.53l-10.53,23.68L148.88,196.25z'
          />
          <path fill='#34A853' d='M33.09,172.57l10.53,23.68h105.26v-47.37H43.62L33.09,172.57z' />
          <path
            fill='#4285F4'
            d='M12.04-3.75C3.32-3.75-3.75,3.32-3.75,12.04v136.84l23.68,10.53l23.68-10.53V43.62h105.26
			l10.53-23.68L148.88-3.75H12.04z'
          />
          <path
            fill='#188038'
            d='M-3.75,148.88v31.58c0,8.72,7.07,15.79,15.79,15.79h31.58v-47.37H-3.75z'
          />
          <path fill='#FBBC04' d='M148.88,43.62v105.26h47.37V43.62l-23.68-10.53L148.88,43.62z' />
          <path
            fill='#1967D2'
            d='M196.25,43.62V12.04c0-8.72-7.07-15.79-15.79-15.79h-31.58v47.37H196.25z'
          />
        </g>
      </g>
    </svg>
  )
}

export function SupabaseIcon(props: SVGProps<SVGSVGElement>) {
  const id = useId()
  const gradient0 = `supabase_paint0_${id}`
  const gradient1 = `supabase_paint1_${id}`

  return (
    <svg
      {...props}
      fill='currentColor'
      width='24'
      height='24'
      viewBox='0 0 27 27'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M15.41 26.26C14.72 27.12 13.34 26.65 13.32 25.55L13.08 9.51H23.87C25.83 9.51 26.92 11.76 25.7 13.29L15.41 26.26Z'
        fill={`url(#${gradient0})`}
      />
      <path
        d='M15.41 26.26C14.72 27.12 13.34 26.65 13.32 25.55L13.08 9.51H23.87C25.83 9.51 26.92 11.76 25.7 13.29L15.41 26.26Z'
        fill={`url(#${gradient1})`}
        fillOpacity='0.2'
      />
      <path
        d='M11.02 0.44C11.7 -0.42 13.08 0.06 13.1 1.15L13.2 17.2H2.55C0.6 17.2 -0.49 14.94 0.72 13.41L11.02 0.44Z'
        fill='#3ECF8E'
      />
      <defs>
        <linearGradient
          id={gradient0}
          x1='13.08'
          y1='13.07'
          x2='22.67'
          y2='17.09'
          gradientUnits='userSpaceOnUse'
        >
          <stop stopColor='#249361' />
          <stop offset='1' stopColor='#3ECF8E' />
        </linearGradient>
        <linearGradient
          id={gradient1}
          x1='8.83'
          y1='7.24'
          x2='13.21'
          y2='15.48'
          gradientUnits='userSpaceOnUse'
        >
          <stop />
          <stop offset='1' stopOpacity='0' />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function WhatsAppIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='16'
      height='16'
      fill='currentColor'
      viewBox='0 0 16 16'
    >
      <path d='M13.6 2.33A7.85 7.85 0 0 0 7.99 0C3.63 0 .068 3.56.064 7.93c0 1.4.366 2.76 1.06 3.97L0 16l4.2-1.1a7.9 7.9 0 0 0 3.79.97h.004c4.37 0 7.93-3.56 7.93-7.93A7.9 7.9 0 0 0 13.6 2.33zM7.99 14.52a6.6 6.6 0 0 1-3.36-.92l-.24-.144-2.49.654.67-2.43-.156-.251a6.56 6.56 0 0 1-1.01-3.5c0-3.63 2.96-6.58 6.59-6.58a6.56 6.56 0 0 1 4.66 1.93 6.56 6.56 0 0 1 1.93 4.66c-.004 3.64-2.96 6.59-6.59 6.59m3.62-4.93c-.197-.099-1.17-.578-1.35-.646-.182-.065-.315-.099-.445.1-.133.2-.513.65-.627.78-.114.13-.232.15-.43.05-.197-.1-.836-.308-1.59-.985-.59-.525-.985-1.17-1.1-1.37-.114-.198-.011-.304.09-.403.09-.88.2-.232.3-.346.1-.114.13-.198.2-.33.07-.134.03-.248-.015-.347-.05-.099-.445-1.08-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.25c-.182.2-.691.68-.691 1.65s.71 1.92.81 2.05c.98.13 1.39 2.13 3.38 2.99.47.21.84.33 1.13.418.48.152.9.129 1.25.08.38-.058 1.17-.48 1.34-.943.16-.464.16-.86.11-.943-.049-.084-.182-.133-.38-.232' />
    </svg>
  )
}

export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      fill='currentColor'
      width='24'
      height='24'
      viewBox='0 0 28 23'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M14 6.51C12.7 6.51 11.46 7.03 10.55 7.94C9.63 8.86 9.12 10.1 9.12 11.4C9.12 12.69 9.63 13.93 10.55 14.85C11.46 15.76 12.7 16.28 14 16.28C15.3 16.28 16.54 15.76 17.45 14.85C18.37 13.93 18.88 12.69 18.88 11.4C18.88 10.1 18.37 8.86 17.45 7.94C16.54 7.03 15.3 6.51 14 6.51ZM11.07 11.4C11.07 10.62 11.38 9.87 11.93 9.32C12.48 8.77 13.22 8.47 14 8.47C14.78 8.47 15.52 8.77 16.07 9.32C16.62 9.87 16.93 10.62 16.93 11.4C16.93 12.17 16.62 12.92 16.07 13.47C15.52 14.02 14.78 14.33 14 14.33C13.22 14.33 12.48 14.02 11.93 13.47C11.38 12.92 11.07 12.17 11.07 11.4Z'
      />
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M14 0C8.12 0 4.16 3.52 1.86 6.51L1.82 6.56C1.3 7.24 0.82 7.86 0.5 8.59C0.15 9.38 0 10.24 0 11.4C0 12.55 0.15 13.41 0.5 14.2C0.82 14.93 1.3 15.56 1.82 16.23L1.86 16.28C4.16 19.27 8.12 22.79 14 22.79C19.88 22.79 23.84 19.27 26.14 16.28L26.18 16.23C26.7 15.56 27.18 14.93 27.5 14.2C27.85 13.41 28 12.55 28 11.4C28 10.24 27.85 9.38 27.5 8.59C27.18 7.86 26.7 7.24 26.18 6.56L26.14 6.51C23.84 3.52 19.88 0 14 0ZM3.41 7.7C5.53 4.94 8.99 1.95 14 1.95C19.01 1.95 22.47 4.94 24.59 7.7C25.16 8.44 25.49 8.88 25.71 9.38C25.92 9.85 26.05 10.42 26.05 11.4C26.05 12.37 25.92 12.94 25.71 13.41C25.49 13.91 25.16 14.35 24.59 15.09C22.47 17.85 19.01 20.84 14 20.84C8.99 20.84 5.53 17.85 3.41 15.09C2.84 14.35 2.51 13.91 2.29 13.41C2.08 12.94 1.95 12.37 1.95 11.4C1.95 10.42 2.08 9.85 2.29 9.38C2.51 8.88 2.84 8.44 3.41 7.7Z'
      />
    </svg>
  )
}

export function TwilioIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns='http://www.w3.org/2000/svg' viewBox='-8 -8 272 272'>
      <path
        fill='currentColor'
        d='M128 0c70.66 0 128 57.34 128 128s-57.34 128-128 128S0 198.66 0 128 57.34 0 128 0zm0 33.79c-52.22 0-94.21 41.98-94.21 94.21S75.78 222.21 128 222.21s94.21-41.98 94.21-94.21S180.22 33.79 128 33.79zm31.74 99.33c14.7 0 26.62 11.92 26.62 26.62 0 14.7-11.92 26.62-26.62 26.62-14.7 0-26.62-11.92-26.62-26.62 0-14.7 11.92-26.62 26.62-26.62zm-63.49 0c14.7 0 26.62 11.92 26.62 26.62 0 14.7-11.92 26.62-26.62 26.62-14.7 0-26.62-11.92-26.62-26.62 0-14.7 11.92-26.62 26.62-26.62zm63.49-63.49c14.7 0 26.62 11.92 26.62 26.62 0 14.7-11.92 26.62-26.62 26.62-14.7 0-26.62-11.92-26.62-26.62 0-14.7 11.92-26.62 26.62-26.62zm-63.49 0c14.7 0 26.62 11.92 26.62 26.62 0 14.7-11.92 26.62-26.62 26.62-14.7 0-26.62-11.92-26.62-26.62 0-14.7 11.92-26.62 26.62-26.62z'
      />
    </svg>
  )
}

export function ImageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='26'
      height='26'
      viewBox='0 0 26 26'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M24.9 10.32C16.09 9.11 8.49 15.65 9 24.33M5.67 7.67C5.67 8.37 5.95 9.05 6.45 9.55C6.95 10.05 7.63 10.33 8.33 10.33C9.04 10.33 9.72 10.05 10.22 9.55C10.72 9.05 11 8.37 11 7.67C11 6.96 10.72 6.28 10.22 5.78C9.72 5.28 9.04 5 8.33 5C7.63 5 6.95 5.28 6.45 5.78C5.95 6.28 5.67 6.96 5.67 7.67Z' />
      <path d='M1 14.42C4.71 13.91 8.03 15.7 9.83 18.55' />
      <path d='M1 9.53C1 6.55 1 5.05 1.58 3.91C2.09 2.91 2.91 2.09 3.91 1.58C5.05 1 6.55 1 9.53 1H16.47C19.45 1 20.95 1 22.09 1.58C23.09 2.09 23.91 2.91 24.42 3.91C25 5.05 25 6.55 25 9.53V16.47C25 19.45 25 20.95 24.42 22.09C23.91 23.09 23.09 23.91 22.09 24.42C20.95 25 19.45 25 16.47 25H9.53C6.55 25 5.05 25 3.91 24.42C2.91 23.91 2.09 23.09 1.58 22.09C1 20.95 1 19.45 1 16.47V9.53Z' />
    </svg>
  )
}

export function EmbeddingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='26'
      height='26'
      viewBox='0 0 26 26'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      {/* Rays sit below the nodes in weight, but not so far below that they
          wash out to loose dots at the 14px search-row size. */}
      <path
        d='M13 13L5.5 6.5M13 13L21 7M13 13L6.5 20M13 13L21 19'
        strokeWidth='1.6'
        opacity='0.9'
      />
      <circle cx='13' cy='13' r='3.1' fill='currentColor' stroke='none' />
      <circle cx='5.5' cy='6.5' r='1.9' fill='currentColor' stroke='none' />
      <circle cx='21' cy='7' r='1.9' fill='currentColor' stroke='none' />
      <circle cx='6.5' cy='20' r='1.9' fill='currentColor' stroke='none' />
      <circle cx='21' cy='19' r='1.9' fill='currentColor' stroke='none' />
    </svg>
  )
}

export function DocumentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='23'
      height='28'
      viewBox='0 0 23 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M8 15.2H15.2M8 20H11.6M2 4.4V23.6C2 24.24 2.25 24.85 2.7 25.3C3.15 25.75 3.76 26 4.4 26H18.8C19.44 26 20.05 25.75 20.5 25.3C20.95 24.85 21.2 24.24 21.2 23.6V9.61C21.2 9.29 21.14 8.97 21.01 8.68C20.89 8.38 20.71 8.12 20.48 7.89L15.15 2.68C14.7 2.25 14.1 2 13.47 2H4.4C3.76 2 3.15 2.25 2.7 2.7C2.25 3.15 2 3.76 2 4.4Z'
        stroke='currentColor'
        strokeWidth='2.25'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M14 2V6.8C14 7.44 14.25 8.05 14.7 8.5C15.15 8.95 15.76 9.2 16.4 9.2H21.2'
        stroke='currentColor'
        strokeWidth='2.25'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function MistralIcon(props: SVGProps<SVGSVGElement>) {
  const id = useId()
  const clipId = `mistral_clip_${id}`

  return (
    <svg
      {...props}
      width='22'
      height='22'
      viewBox='1 0.5 24 22'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      preserveAspectRatio='xMidYMid meet'
    >
      <g clipPath={`url(#${clipId})`}>
        <path d='M17.45 0H21.82V4.39H17.45V0Z' fill='black' />
        <path d='M19.64 0H24V4.39H19.64V0Z' fill='#F7D046' />
        <path
          d='M0 0H4.36V4.39H0V0ZM0 4.39H4.36V8.79H0V4.39ZM0 8.79H4.36V13.18H0V8.79ZM0 13.18H4.36V17.58H0V13.18ZM0 17.58H4.36V21.97H0V17.58Z'
          fill='black'
        />
        <path d='M2.18 0H6.55V4.39H2.18V0Z' fill='#F7D046' />
        <path d='M19.64 4.39H24V8.79H19.64V4.39ZM2.18 4.39H6.55V8.79H2.18V4.39Z' fill='#F2A73B' />
        <path d='M13.09 4.39H17.45V8.79H13.09V4.39Z' fill='black' />
        <path
          d='M15.27 4.39H19.64V8.79H15.27V4.39ZM6.55 4.39H10.91V8.79H6.55V4.39Z'
          fill='#F2A73B'
        />
        <path
          d='M10.91 8.79H15.27V13.18H10.91V8.79ZM15.27 8.79H19.64V13.18H15.27V8.79ZM6.55 8.79H10.91V13.18H6.55V8.79Z'
          fill='#EE792F'
        />
        <path d='M8.73 13.18H13.09V17.58H8.73V13.18Z' fill='black' />
        <path d='M10.91 13.18H15.27V17.58H10.91V13.18Z' fill='#EB5829' />
        <path d='M19.64 8.79H24V13.18H19.64V8.79ZM2.18 8.79H6.55V13.18H2.18V8.79Z' fill='#EE792F' />
        <path d='M17.45 13.18H21.82V17.58H17.45V13.18Z' fill='black' />
        <path d='M19.64 13.18H24V17.58H19.64V13.18Z' fill='#EB5829' />
        <path d='M17.45 17.58H21.82V21.97H17.45V17.58Z' fill='black' />
        <path d='M2.18 13.18H6.55V17.58H2.18V13.18Z' fill='#EB5829' />
        <path
          d='M19.64 17.58H24V21.97H19.64V17.58ZM2.18 17.58H6.55V21.97H2.18V17.58Z'
          fill='#EA3326'
        />
      </g>
      <defs>
        <clipPath id={clipId}>
          <rect width='24' height='22' fill='white' />
        </clipPath>
      </defs>
    </svg>
  )
}

export function BrainIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 256 256' fill='currentColor' xmlns='http://www.w3.org/2000/svg'>
      <path d='M212,76V72a44,44,0,0,0-74.86-31.31,3.93,3.93,0,0,0-1.14,2.8v88.72a4,4,0,0,0,6.2,3.33A47.67,47.67,0,0,1,167.68,128a8.18,8.18,0,0,1,8.31,7.58,8,8,0,0,1-8,8.42,32,32,0,0,0-32,32v33.88a4,4,0,0,0,1.49,3.12,47.92,47.92,0,0,0,74.21-17.16,4,4,0,0,0-4.49-5.56A68.06,68.06,0,0,1,192,192h-7.73a8.18,8.18,0,0,1-8.25-7.47,8,8,0,0,1,8-8.53h8a51.6,51.6,0,0,0,24-5.88v0A52,52,0,0,0,212,76Zm-12,36h-4a36,36,0,0,1-36-36V72a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4a8,8,0,0,1,0,16ZM88,28A44.05,44.05,0,0,0,44,72v4a52,52,0,0,0-4,94.12h0A51.6,51.6,0,0,0,64,176h7.73A8.18,8.18,0,0,1,80,183.47,8,8,0,0,1,72,192H64a67.48,67.48,0,0,1-15.21-1.73,4,4,0,0,0-4.5,5.55A47.93,47.93,0,0,0,118.51,213a4,4,0,0,0,1.49-3.12V176a32,32,0,0,0-32-32,8,8,0,0,1-8-8.42A8.18,8.18,0,0,1,88.32,128a47.67,47.67,0,0,1,25.48,7.54,4,4,0,0,0,6.2-3.33V43.49a4,4,0,0,0-1.14-2.81A43.85,43.85,0,0,0,88,28Zm8,48a36,36,0,0,1-36,36H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,76V72a8,8,0,0,1,16,0Z' />
    </svg>
  )
}

export function ElevenLabsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='876'
      height='876'
      viewBox='0 0 876 876'
      fill='none'
    >
      <path d='M498 138H618V738H498V138Z' fill='currentColor' />
      <path d='M258 138H378V738H258V138Z' fill='currentColor' />
    </svg>
  )
}

export function TelegramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      viewBox='1 1 22 22'
      width='24'
      height='24'
      fill='none'
    >
      <circle cx='12' cy='12' r='10' fill='#0088CC' />
      <path
        d='M16.7 8.4c.1-.6-.4-1.1-1-.8l-9.8 4.3c-.4.2-.4.8.1.9l2.1.7c.4.1.8.1 1.1-.2l4.5-3.1c.1-.1.3.1.2.2l-3.2 3.5c-.3.3-.2.8.2 1l3.6 2.3c.4.2.9-.1 1-.5l1.2-7.8Z'
        fill='white'
      />
    </svg>
  )
}

export function MicrosoftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 109 109' {...props}>
      <polygon fill='#F1511B' points='51.9,51.9 0,51.9 0,0 51.9,0' />
      <polygon fill='#80CC28' points='109.3,51.9 57.3,51.9 57.3,0 109.3,0' />
      <polygon fill='#00ADEF' points='51.9,109.3 0,109.3 0,57.4 51.9,57.4' />
      <polygon fill='#FBBC09' points='109.3,109.3 57.3,109.3 57.3,57.4 109.3,57.4' />
    </svg>
  )
}

export function MicrosoftCopilotIcon(props: SVGProps<SVGSVGElement>) {
  const id = useId()
  const gid = (name: string) => `mscopilot_${name}_${id}`

  return (
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 23.3 512.1 465.4' {...props}>
      <radialGradient
        id={gid('a')}
        cx='-79.674'
        cy='645.551'
        r='11.637'
        gradientTransform='matrix(-10.9605 -13.3892 -12.5901 10.3064 7673.291 -7504.614)'
        gradientUnits='userSpaceOnUse'
      >
        <stop offset='.096' stopColor='#00aeff' />
        <stop offset='.773' stopColor='#2253ce' />
        <stop offset='1' stopColor='#0736c4' />
      </radialGradient>
      <path
        fill={`url(#${gid('a')})`}
        d='M374 62c-6.7-22.9-27.8-38.7-51.7-38.7h-15.7c-26 0-48.3 18.6-53 44.2l-26.9 146.8 6.7-22.9c6.7-23 27.8-38.8 51.7-38.8h91.4l38.3 14.9 36.9-14.9H441c-23.9 0-45-15.8-51.7-38.7z'
      />
      <radialGradient
        id={gid('b')}
        cx='-20.581'
        cy='641.788'
        r='11.637'
        gradientTransform='matrix(9.8803 12.5737 12.1968 -9.5842 -7518.271 6768.395)'
        gradientUnits='userSpaceOnUse'
      >
        <stop offset='0' stopColor='#ffb657' />
        <stop offset='.634' stopColor='#ff5f3d' />
        <stop offset='.923' stopColor='#c02b3c' />
      </radialGradient>
      <path
        fill={`url(#${gid('b')})`}
        d='M143.5 449.8c6.7 23 27.8 38.9 51.8 38.9h33.4c29.2 0 53.1-23.3 53.9-52.5l3.6-141.5-7.6 26c-6.7 23-27.8 38.7-51.7 38.7h-92.2l-32.9-17.8-35.6 17.8h10.6c24 0 45.1 15.9 51.8 38.9z'
      />
      <linearGradient
        id={gid('c')}
        x1='151.476'
        x2='178.106'
        y1='452.543'
        y2='144.451'
        gradientTransform='matrix(1 0 0 -1 0 514)'
        gradientUnits='userSpaceOnUse'
      >
        <stop offset='.156' stopColor='#0d91e1' />
        <stop offset='.487' stopColor='#52b471' />
        <stop offset='.652' stopColor='#98bd42' />
        <stop offset='.937' stopColor='#ffc800' />
      </linearGradient>
      <path
        fill={`url(#${gid('c')})`}
        d='M320 23.3H133.4C80 23.3 48 93.7 26.7 164.2 1.4 247.7-31.6 359.4 64 359.4h80.6c24.1 0 45.2-15.9 51.8-39.1 14-49 38.6-134.5 57.9-199.6 9.8-33.1 18-61.5 30.5-79.2 7.1-9.9 18.8-18.2 35.2-18.2'
      />
      <linearGradient
        id={gid('d')}
        x1='154.129'
        x2='168.669'
        y1='491.116'
        y2='155.012'
        gradientTransform='matrix(1 0 0 -1 0 514)'
        gradientUnits='userSpaceOnUse'
      >
        <stop offset='0' stopColor='#3dcbff' />
        <stop offset='.247' stopColor='#0588f7' stopOpacity='0' />
      </linearGradient>
      <path
        fill={`url(#${gid('d')})`}
        d='M320 23.3H133.4C80 23.3 48 93.7 26.7 164.2 1.4 247.7-31.6 359.4 64 359.4h80.6c24.1 0 45.2-15.9 51.8-39.1 14-49 38.6-134.5 57.9-199.6 9.8-33.1 18-61.5 30.5-79.2 7.1-9.9 18.8-18.2 35.2-18.2'
      />
      <radialGradient
        id={gid('e')}
        cx='-46.943'
        cy='664.318'
        r='11.637'
        gradientTransform='matrix(-12.6711 36.2357 43.4092 15.1796 -28974.764 -8263.428)'
        gradientUnits='userSpaceOnUse'
      >
        <stop offset='.066' stopColor='#8c48ff' />
        <stop offset='.5' stopColor='#f2598a' />
        <stop offset='.896' stopColor='#ffb152' />
      </radialGradient>
      <path
        fill={`url(#${gid('e')})`}
        d='M192 488.7h186.7c53.3 0 85.3-70.5 106.7-141 25.3-83.5 58.3-195.2-37.3-195.2h-80.6c-24.1 0-45.2 15.9-51.8 39.1-14 49-38.6 134.6-57.9 199.7-9.8 33.1-18 61.5-30.5 79.2-7.2 9.9-18.9 18.2-35.3 18.2'
      />
      <linearGradient
        id={gid('f')}
        x1='352.459'
        x2='352.268'
        y1='382.231'
        y2='290.663'
        gradientTransform='matrix(1 0 0 -1 0 514)'
        gradientUnits='userSpaceOnUse'
      >
        <stop offset='.058' stopColor='#f8adfa' />
        <stop offset='.708' stopColor='#a86edd' stopOpacity='0' />
      </linearGradient>
      <path
        fill={`url(#${gid('f')})`}
        d='M192 488.7h186.7c53.3 0 85.3-70.5 106.7-141 25.3-83.5 58.3-195.2-37.3-195.2h-80.6c-24.1 0-45.2 15.9-51.8 39.1-14 49-38.6 134.6-57.9 199.7-9.8 33.1-18 61.5-30.5 79.2-7.2 9.9-18.9 18.2-35.3 18.2'
      />
    </svg>
  )
}

export function PackageSearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14' />
      <path d='m7.5 4.27 9 5.15' />
      <polyline points='3.29 7 12 12 20.71 7' />
      <line x1='12' x2='12' y1='22' y2='12' />
      <circle cx='18.5' cy='15.5' r='2.5' />
      <path d='M20.27 17.27 22 19' />
    </svg>
  )
}

export const ResponseIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    fill='currentColor'
    width='800px'
    height='800px'
    viewBox='0 0 1920 1920'
    xmlns='http://www.w3.org/2000/svg'
  >
    <path
      d='m1030.97 188 81.25 81.25-429.23 429.23h300.75c516.22 0 936.26 420.03 936.26 936.26v98.03h-114.92v-98.03c0-452.9-368.44-821.34-821.34-821.34H683l429.23 429.23-81.25 81.25-567.94-567.94L1030.97 188Zm-463.04.011 81.25 81.25-486.69 486.69 486.69 486.69-81.25 81.25L0 755.95 567.94 188.01Z'
      fillRule='evenodd'
    />
  </svg>
)

export const AnthropicIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    fill='currentColor'
    fillRule='evenodd'
    height='1em'
    viewBox='0 0 24 24'
    width='1em'
    xmlns='http://www.w3.org/2000/svg'
  >
    <title>Anthropic</title>
    <path d='M13.83 3.52h3.6L24 20h-3.6l-6.57-16.48zm-7.26 0h3.77L16.91 20h-3.67l-1.34-3.46H5.02l-1.34 3.46H0L6.57 3.52zm4.13 9.96L8.45 7.69 6.21 13.48H10.7z' />
  </svg>
)

export function GeminiIcon(props: SVGProps<SVGSVGElement>) {
  const id = useId()
  const gradientId = `gemini_gradient_${id}`

  return (
    <svg {...props} height='1em' viewBox='0 0 24 24' width='1em' xmlns='http://www.w3.org/2000/svg'>
      <title>Gemini</title>
      <defs>
        <linearGradient id={gradientId} x1='0%' x2='68.73%' y1='100%' y2='30.4%'>
          <stop offset='0%' stopColor='#1C7DFF' />
          <stop offset='52.02%' stopColor='#1C69FF' />
          <stop offset='100%' stopColor='#F0DCD6' />
        </linearGradient>
      </defs>
      <path
        d='M12 24A14.3 14.3 0 000 12 14.3 14.3 0 0012 0a14.31 14.31 0 0012 12 14.31 14.31 0 00-12 12'
        fill={`url(#${gradientId})`}
        fillRule='nonzero'
      />
    </svg>
  )
}

export const FalIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...props} height='1em' viewBox='0 0 24 24' width='1em' xmlns='http://www.w3.org/2000/svg'>
    <title>Fal</title>
    <path
      clipRule='evenodd'
      d='M15.477 0c.415 0 .749.338.788.752a7.775 7.775 0 006.985 6.984c.413.04.752.373.752.788v6.952c0 .415-.338.748-.752.788a7.775 7.775 0 00-6.985 6.984c-.04.414-.373.752-.788.752H8.525c-.416 0-.749-.338-.789-.752a7.775 7.775 0 00-6.984-6.984c-.414-.04-.752-.373-.752-.788V8.524c0-.415.338-.748.752-.788A7.775 7.775 0 007.736.752C7.776.338 8.11 0 8.526 0h6.95zM4.819 11.98a7.226 7.226 0 007.223 7.23 7.226 7.226 0 007.223-7.23c0-3.994-3.234-7.23-7.223-7.23a7.227 7.227 0 00-7.223 7.23z'
      fill='#EC0648'
      fillRule='evenodd'
    />
  </svg>
)
export function ShieldCheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10' />
      <path d='m9 12 2 2 4-4' />
    </svg>
  )
}

export function WebhookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      fill='currentColor'
      width='800px'
      height='800px'
      viewBox='0 0 24 24'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path d='M17.97 7A4.97 4.97 0 0 0 18 6.5a5.5 5.5 0 1 0-8.67 4.49L7.18 15.11A2.43 2.43 0 0 0 6.5 15 2.5 2.5 0 1 0 9 17.5a2.36 2.36 0 0 0-.93-1.92l2.58-4.94-.41-.241A4.5 4.5 0 1 1 17 6.5a4.8 4.8 0 0 1-.22.45zM6.5 19a1.5 1.5 0 1 1 1.5-1.5A1.52 1.52 0 0 1 6.5 19zM18.5 12a5.74 5.74 0 0 0-1.45.157l-2.74-3.94A2.41 2.41 0 0 0 15 6.5a2.54 2.54 0 1 0-1.52 2.28l3.17 4.56.36-.13A4.27 4.27 0 0 1 18.5 13a4.5 4.5 0 1 1-.008 9h-.006a4.68 4.68 0 0 1-3.12-1.35l-.703.71A5.65 5.65 0 0 0 18.49 23h.011a5.5 5.5 0 0 0 0-11zM11 6.5A1.5 1.5 0 1 1 12.5 8 1.51 1.51 0 0 1 11 6.5zM18.5 20a2.5 2.5 0 1 0-2.45-3h-5.05l-.3.5A4.55 4.55 0 0 1 6.5 22 4.53 4.53 0 0 1 2 17.5a4.6 4.6 0 0 1 3.15-4.37l-.296-.954A5.61 5.61 0 0 0 1 17.5 5.53 5.53 0 0 0 6.5 23a5.57 5.57 0 0 0 5.48-5h4.08a2.49 2.49 0 0 0 2.44 2zm0-4a1.5 1.5 0 1 1-1.5 1.5 1.51 1.51 0 0 1 1.5-1.5z' />
      <path fill='none' d='M0 0h24v24H0z' />
    </svg>
  )
}

export function ScheduleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M8 2v4' />
      <path d='M16 2v4' />
      <rect width='18' height='18' x='3' y='4' rx='2' />
      <path d='M3 10h18' />
    </svg>
  )
}

export function PostgresIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='800px'
      height='800px'
      viewBox='-4 0 264 264'
      xmlns='http://www.w3.org/2000/svg'
      preserveAspectRatio='xMinYMin meet'
    >
      <path d='M255.01 158.09c-1.53-4.65-5.56-7.89-10.76-8.66-2.45-.366-5.26-.21-8.58.475-5.79 1.2-10.09 1.65-13.22 1.74 11.84-19.98 21.46-42.77 27-64.23 8.96-34.69 4.17-50.49-1.42-57.64C233.22 10.85 211.61.683 185.55.372c-13.9-.17-26.11 2.58-32.47 4.55-5.93-1.05-12.3-1.63-18.99-1.74-12.54-.2-23.61 2.53-33.08 8.15-5.24-1.77-13.65-4.27-23.36-5.86-22.84-3.75-41.25-.828-54.72 8.69C6.62 25.67-.937 45.68.461 73.63c.444 8.87 5.41 35.87 13.22 61.48 4.49 14.72 9.28 26.94 14.24 36.33 7.03 13.32 14.55 21.16 22.99 23.97 4.73 1.58 13.33 2.68 22.37-4.85 1.15 1.39 2.68 2.77 4.7 4.05 2.58 1.63 5.73 2.95 8.88 3.74 11.34 2.84 21.96 2.13 31.03-1.85.056 1.61.099 3.15.135 4.48.06 2.16.12 4.27.199 6.25.54 13.37 1.45 23.77 4.14 31.05.148.4.35 1.1.56 1.66 1.35 4.12 3.59 11.01 9.32 16.41 5.93 5.59 13.09 7.31 19.66 7.31 3.29 0 6.43-.432 9.19-1.02 9.82-2.1 20.97-5.31 29.04-16.8 7.63-10.86 11.34-27.22 12.01-52.99.09-.729.17-1.42.244-2.09l.16-1.36 1.8.158.46.031c10.002.456 22.232-1.665 29.743-5.154 5.935-2.754 24.954-12.795 20.476-26.351' />
      <path
        d='M237.91 160.72c-29.74 6.14-31.78-3.93-31.78-3.93 31.4-46.59 44.53-105.74 33.2-120.21-30.9-39.48-84.4-20.81-85.29-20.33l-.287.05c-5.88-1.22-12.45-1.95-19.84-2.07-13.46-.22-23.66 3.53-31.41 9.4 0 0-95.43-39.31-90.99 49.44.944 18.88 27.06 142.87 58.22 105.42 11.39-13.69 22.39-25.27 22.39-25.27 5.46 3.63 12.01 5.48 18.86 4.82l.533-.452c-.166 1.7-.09 3.36.213 5.33-8.03 8.97-5.67 10.54-21.71 13.84-16.23 3.35-6.7 9.3-.471 10.86 7.55 1.89 25.01 4.56 36.81-11.96l-.47 1.89c3.14 2.52 5.35 16.38 4.98 28.95-.37 12.57-.617 21.2 1.86 27.94 2.48 6.74 4.95 21.91 26.04 17.39 17.62-3.78 26.76-13.56 28.03-29.89.9-11.61 2.94-9.89 3.07-20.27l1.64-4.91c1.89-15.73.3-20.81 11.16-18.45l2.64.23c7.99.36 18.45-1.29 24.59-4.14 13.22-6.13 21.06-16.38 8.02-13.69h.002'
        fill='#336791'
      />
      <path
        d='M108.08 81.53c-2.68-.373-5.11-.028-6.33.902-.69.52-.904 1.13-.962 1.55-.154 1.11.62 2.33 1.1 2.96 1.35 1.78 3.31 3.01 5.26 3.28.28.4.56.58.84.058 3.25 0 6.2-2.53 6.46-4.39.325-2.34-3.07-3.89-6.35-4.35M196.86 81.6c-.256-1.83-3.51-2.35-6.61-1.92-3.09.43-6.08 1.82-5.83 3.66.2 1.43 2.78 3.86 5.83 3.86.258 0 .518-.017.78-.054 2.04-.282 3.53-1.57 4.24-2.32 1.08-1.14 1.71-2.4 1.59-3.22'
        fill='#FFF'
      />
      <path
        d='M247.8 160.03c-1.13-3.43-4.78-4.53-10.85-3.28-18 3.72-24.45 1.14-26.57-.417 14-21.32 25.51-47.09 31.72-71.14 2.94-11.39 4.57-21.97 4.7-30.59.15-9.46-1.46-16.42-4.79-20.66-13.4-17.12-33.07-26.31-56.88-26.56-16.37-.184-30.2 4.01-32.88 5.18-5.65-1.4-11.8-2.27-18.5-2.38-12.29-.199-22.91 2.74-31.7 8.74-3.82-1.42-13.69-4.81-25.76-6.76-20.87-3.36-37.46-.814-49.29 7.57-14.12 10.01-20.64 27.89-19.38 53.16.43 8.5 5.27 34.65 12.91 59.7 10.06 32.96 21 51.63 32.51 55.46 1.35.449 2.9.76 4.61.763 4.2 0 9.35-1.89 14.7-8.33a529.83 529.83 0 0 1 20.26-22.93c4.52 2.43 9.49 3.78 14.58 3.92.1.13.23.27.35.4a117.66 117.66 0 0 0-2.57 3.18c-3.52 4.47-4.25 5.4-15.59 7.74-3.22.666-11.79 2.43-11.92 8.44-.136 6.56 10.13 9.32 11.29 9.61 4.07 1.02 8 1.52 11.74 1.52 9.1 0 17.11-2.99 23.52-8.78-.197 23.39.778 46.43 3.59 53.45 2.3 5.75 7.92 19.8 25.66 19.79 2.6 0 5.47-.303 8.62-.979 18.52-3.97 26.56-12.16 29.68-30.2 1.67-9.64 4.52-32.68 5.87-45.03 2.84.885 6.49 1.29 10.43 1.29 8.23 0 17.73-1.75 23.69-4.51 6.69-3.11 18.77-10.73 16.58-17.36zm-44.11-83.48c-.061 3.65-.563 6.96-1.09 10.41-.573 3.72-1.16 7.56-1.31 12.23-.147 4.54.42 9.26.97 13.83 1.11 9.22 2.25 18.71-2.16 28.08a36.51 36.51 0 0 1-1.95-4.01c-.547-1.33-1.73-3.46-3.38-6.4-6.4-11.48-21.38-38.35-13.71-49.32 2.29-3.26 8.08-6.62 22.64-4.81zm-17.64-61.79c21.33.471 38.21 8.45 50.16 23.72 9.16 11.71-.927 65-30.14 110.97a171.33 171.33 0 0 0-.886-1.12l-.37-.462c7.55-12.47 6.07-24.8 4.76-35.74-.54-4.49-1.05-8.73-.92-12.71.134-4.22.69-7.84 1.23-11.34.66-4.31 1.34-8.78 1.15-14.04.139-.552.2-1.2.122-1.98-.475-5.04-6.23-20.14-17.98-33.81-6.42-7.47-15.79-15.84-28.57-21.48 5.5-1.14 13.02-2.2 21.44-2.02zM66.67 175.78c-5.9 7.09-9.97 5.73-11.31 5.29-8.73-2.91-18.86-21.36-27.79-50.62-7.73-25.32-12.24-50.78-12.6-57.92-1.13-22.58 4.35-38.31 16.27-46.77 19.4-13.76 51.31-5.52 64.13-1.35-.184.18-.376.35-.558.54-21.04 21.24-20.54 57.54-20.48 59.76-.2.86.07 2.07.168 3.74.362 6.11 1.04 17.47-.764 30.33-1.67 11.96 2.01 23.66 10.11 32.11a36.28 36.28 0 0 0 2.62 2.47c-3.6 3.86-11.44 12.4-19.77 22.43zm22.48-29.99c-6.53-6.81-9.49-16.28-8.13-25.99 1.9-13.59 1.2-25.43.82-31.79-.053-.89-.1-1.67-.127-2.28 3.07-2.72 17.31-10.35 27.47-8.03 4.63 1.06 7.46 4.22 8.63 9.65 6.08 28.1.804 39.82-3.43 49.23-.873 1.94-1.7 3.77-2.4 5.67l-.546 1.47c-1.38 3.71-2.67 7.15-3.46 10.42-6.94-.02-13.69-2.98-18.82-8.34zm1.07 37.9c-2.03-.506-3.85-1.38-4.92-2.11.893-.42 2.48-.992 5.24-1.56 13.34-2.74 15.4-4.68 19.9-10.39 1.03-1.31 2.2-2.79 3.82-4.6l.002-.002c2.41-2.7 3.51-2.24 5.51-1.41 1.62.67 3.2 2.7 3.84 4.94.303 1.06.643 3.06-.47 4.62-9.4 13.16-23.09 12.99-32.92 10.53zm69.8 64.95c-16.32 3.5-22.09-4.83-25.9-14.35-2.46-6.14-3.66-33.85-2.81-64.45.011-.407-.047-.8-.159-1.17a15.44 15.44 0 0 0-.456-2.16c-1.27-4.45-4.38-8.18-8.1-9.72-1.48-.613-4.2-1.74-7.46-.903.7-2.87 1.9-6.11 3.21-9.61l.549-1.47c.618-1.66 1.39-3.39 2.21-5.21 4.43-9.85 10.5-23.34 3.92-53.81-2.47-11.41-10.71-16.99-23.2-15.69-7.49.78-14.34 3.8-17.76 5.53-.735.37-1.41.732-2.03 1.08.954-11.5 4.56-32.99 18.04-46.59 8.49-8.56 19.79-12.79 33.57-12.56 27.14.44 44.54 14.37 54.37 25.98 8.46 10 13.05 20.08 14.88 25.51-13.75-1.4-23.11 1.32-27.85 8.1-10.32 14.75 5.64 43.37 13.32 57.13 1.41 2.52 2.62 4.7 3 5.63 2.5 6.05 5.73 10.1 8.09 13.05.724.9 1.43 1.78 1.96 2.55-4.17 1.2-11.65 3.98-10.97 17.85-.55 6.96-4.46 39.55-6.45 51.06-2.62 15.21-8.22 20.88-23.96 24.25zm68.1-77.94c-4.26 1.98-11.39 3.46-18.16 3.78-7.48.35-11.29-.838-12.18-1.57-.42-8.64 2.8-9.55 6.2-10.5.535-.15 1.06-.297 1.56-.473.31.255.66.508 1.03.756 6.01 3.97 16.74 4.4 31.87 1.27l.166-.033c-2.04 1.91-5.54 4.47-10.49 6.77z'
        fill='#FFF'
      />
    </svg>
  )
}

export function MySQLIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='64'
      height='64'
      viewBox='0 0 25.6 25.6'
    >
      <path
        d='M179.08 94.89c-3.57-.1-6.34.268-8.66 1.25-.668.27-1.74.27-1.83 1.12.357.36.4.94.713 1.43.535.89 1.47 2.1 2.32 2.72l2.86 2.05c1.74 1.07 3.7 1.7 5.4 2.77.982.63 1.96 1.43 2.95 2.1.5.36.803.94 1.43 1.16v-.135c-.312-.4-.402-.98-.713-1.43l-1.34-1.29c-1.29-1.74-2.9-3.26-4.64-4.51-1.43-.982-4.55-2.32-5.13-3.97l-.088-.1c.98-.1 2.14-.447 3.08-.715 1.52-.4 2.9-.312 4.46-.713l2.14-.625v-.4c-.803-.803-1.38-1.87-2.23-2.63-2.27-1.96-4.78-3.88-7.36-5.49-1.38-.892-3.17-1.47-4.64-2.23-.537-.268-1.43-.402-1.74-.848-.805-.98-1.25-2.27-1.83-3.44l-3.66-7.76c-.803-1.74-1.29-3.48-2.27-5.09-4.6-7.58-9.59-12.18-17.27-16.69-1.65-.937-3.61-1.34-5.7-1.83l-3.35-.18c-.715-.312-1.43-1.16-2.05-1.56-2.54-1.61-9.1-5.09-10.98-.5-1.2 2.9 1.79 5.76 2.8 7.23.76 1.03 1.74 2.19 2.28 3.35.3.76.4 1.56.713 2.37.713 1.96 1.38 4.15 2.32 5.98.5.94 1.02 1.92 1.65 2.77.357.5.98.714 1.12 1.52-.625.89-.668 2.23-1.02 3.35-1.61 5.04-.982 11.29 1.29 15 .715 1.12 2.4 3.57 4.69 2.63 2.01-.803 1.56-3.35 2.14-5.58.135-.535.04-.892.31-1.25v.1l1.83 3.7c1.38 2.19 3.79 4.46 5.8 5.98 1.7.8 1.92 2.19 3.26 2.68v-.135h-.088c-.268-.4-.67-.58-1.03-.892-.803-.803-1.69-1.78-2.32-2.68-1.87-2.5-3.52-5.26-5-8.12-.715-1.38-1.34-2.9-1.92-4.28-.27-.536-.27-1.34-.715-1.61-.67.98-1.65 1.83-2.14 3.03-.848 1.92-.936 4.28-1.25 6.74-.18.05-.1 0-.18.1-1.43-.356-1.92-1.83-2.45-3.08-1.34-3.17-1.56-8.25-.402-11.91.312-.937 1.65-3.88 1.12-4.77-.27-.848-1.16-1.34-1.65-2.01-.58-.848-1.2-1.92-1.6-2.85-1.07-2.5-1.6-5.26-2.77-7.76-.537-1.16-1.47-2.37-2.23-3.43-.848-1.2-1.78-2.05-2.45-3.48-.223-.5-.535-1.29-.178-1.83.09-.357.27-.5.62-.58.58-.5 2.23.134 2.81.4 1.65.67 3.03 1.29 4.42 2.23.63.446 1.3 1.29 2.1 1.52h.938c1.43.312 3.03.1 4.37.5 2.37.76 4.51 1.87 6.43 3.08 5.84 3.7 10.66 8.97 13.92 15.26.54 1.03.758 1.96 1.25 3.03.938 2.19 2.1 4.42 3.03 6.56.94 2.1 1.83 4.24 3.17 5.98.67.94 3.35 1.43 4.55 1.92.893.4 2.28.76 3.08 1.25 1.52.937 3.03 2.01 4.46 3.03.713.53 2.95 1.65 3.08 2.54zm-45.5-38.77a7.09 7.09 0 0 0-1.83.223v.1h.088c.357.71.982 1.21 1.43 1.83l1.03 2.14.088-.1c.625-.446.94-1.16.94-2.23-.268-.312-.312-.625-.535-.937-.268-.446-.848-.67-1.21-1.03z'
        transform='matrix(.390229 0 0 .38781 -46.3 -16.86)'
        fillRule='evenodd'
        fill='#00678c'
      />
    </svg>
  )
}

export function CohereIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} height='1em' width='1em' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'>
      <title>Cohere</title>
      <path
        d='M8.128 14.099c.592 0 1.77-.033 3.398-.703 1.897-.781 5.672-2.2 8.395-3.656 1.905-1.018 2.74-2.366 2.74-4.18A4.56 4.56 0 0018.1 1H7.549A6.55 6.55 0 001 7.55c0 3.617 2.745 6.549 7.128 6.549z'
        clipRule='evenodd'
        fill='#39594D'
        fillRule='evenodd'
      />
      <path
        d='M9.912 18.61a4.387 4.387 0 012.705-4.052l3.323-1.38c3.361-1.394 7.06 1.076 7.06 4.715a5.104 5.104 0 01-5.105 5.104l-3.597-.001a4.386 4.386 0 01-4.386-4.387z'
        clipRule='evenodd'
        fill='#D18EE2'
        fillRule='evenodd'
      />
      <path
        d='M4.776 14.962A3.775 3.775 0 001 18.738v.489a3.776 3.776 0 007.551 0v-.49a3.775 3.775 0 00-3.775-3.775z'
        fill='#FF7759'
      />
    </svg>
  )
}

export function ServerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <rect width='20' height='8' x='2' y='2' rx='2' ry='2' />
      <rect width='20' height='8' x='2' y='14' rx='2' ry='2' />
      <line x1='6' x2='6.01' y1='6' y2='6' />
      <line x1='6' x2='6.01' y1='18' y2='18' />
    </svg>
  )
}
export const SOC2BadgeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...props} viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <circle cx='50' cy='50' r='48' fill='white' stroke='#E5E7EB' strokeWidth='2' />
    <circle cx='50' cy='50' r='45' fill='#F9FAFB' />
    <text
      x='50'
      y='40'
      textAnchor='middle'
      fill='#1F2937'
      fontSize='20'
      fontWeight='600'
      fontFamily='system-ui, -apple-system, sans-serif'
    >
      SOC 2
    </text>
    <text
      x='50'
      y='56'
      textAnchor='middle'
      fill='#6B7280'
      fontSize='11'
      fontWeight='500'
      fontFamily='system-ui, -apple-system, sans-serif'
    >
      Type II
    </text>
    <text
      x='50'
      y='70'
      textAnchor='middle'
      fill='#9CA3AF'
      fontSize='9'
      fontWeight='400'
      fontFamily='system-ui, -apple-system, sans-serif'
    >
      Compliant
    </text>
  </svg>
)

export function GoogleFormsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 65' fill='none'>
      <path
        d='M29.58 0H4.44C2 0 0 2 0 4.44v56.21C0 63.09 2 65.08 4.44 65.08h38.46c2.44 0 4.44-2 4.44-4.44V17.75L36.98 10.35 29.58 0Z'
        fill='#673AB7'
      />
      <path
        d='M29.58 0v10.35c0 2.45 1.99 4.44 4.44 4.44h13.31L36.98 10.35 29.58 0Z'
        fill='#B39DDB'
      />
      <path
        d='M19.23 50.29h16.27v-2.96H19.23v2.96Zm0-17.75v2.96h16.27v-2.96H19.23Zm-3.7 1.48c0 1.22-0.99 2.22-2.22 2.22s-2.22-0.99-2.22-2.22c0-1.22 1-2.22 2.22-2.22s2.22 1 2.22 2.22Zm0 7.4c0 1.22-0.99 2.22-2.22 2.22s-2.22-0.99-2.22-2.22c0-1.22 1-2.22 2.22-2.22s2.22 1 2.22 2.22Zm0 7.4c0 1.22-0.99 2.22-2.22 2.22s-2.22-0.99-2.22-2.22c0-1.22 1-2.22 2.22-2.22s2.22 1 2.22 2.22Zm3.7-5.92h16.27v-2.96H19.23v2.96Z'
        fill='#F1F1F1'
      />
    </svg>
  )
}

export const SMSIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    fill='#000000'
    width='800px'
    height='800px'
    viewBox='0 0 32 32'
    xmlns='http://www.w3.org/2000/svg'
  >
    <path d='M 2 5 L 2 25 L 7 25 L 7 30.09 L 8.63 28.78 L 13.34 25 L 30 25 L 30 5 Z M 4 7 L 28 7 L 28 23 L 12.66 23 L 12.38 23.22 L 9 25.91 L 9 23 L 4 23 Z M 8 12 L 8 14 L 24 14 L 24 12 Z M 8 16 L 8 18 L 20 18 L 20 16 Z' />
  </svg>
)

export function VariableIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M7 8l-4 4 4 4' />
      <path d='M17 8l4 4-4 4' />
      <line x1='14' y1='4' x2='10' y2='20' />
    </svg>
  )
}

export function HumanInTheLoopIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' />
      <circle cx='12' cy='7' r='4' />
    </svg>
  )
}

export function TrelloIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='256'
      height='256'
      viewBox='0 0 256 256'
      preserveAspectRatio='xMidYMid'
    >
      <rect fill='#0052CC' x='0' y='0' width='256' height='256' rx='32' />
      <rect fill='#FFF' x='144.64' y='33.28' width='78.08' height='112' rx='12' />
      <rect fill='#FFF' x='33.28' y='33.28' width='78.08' height='176' rx='12' />
    </svg>
  )
}

export function PipedriveIcon(props: SVGProps<SVGSVGElement>) {
  const pathId = useId()
  return (
    <svg
      {...props}
      width='304px'
      height='304px'
      viewBox='0 0 304 304'
      version='1.1'
      xmlns='http://www.w3.org/2000/svg'
      xmlnsXlink='http://www.w3.org/1999/xlink'
    >
      <defs>
        <path
          d='M59.68,81.18 C59.68,101.53 70.01,123.49 92.73,123.49 C109.59,123.49 126.63,110.34 126.63,80.88 C126.63,55.05 113.23,37.71 93.29,37.71 C77.05,37.71 59.68,49.12 59.68,81.18 Z M101.3,0 C142.05,0 169.45,32.27 169.45,80.31 C169.45,127.6 140.58,160.61 99.32,160.61 C79.65,160.61 67.05,152.18 60.46,146.08 C60.51,147.53 60.54,149.15 60.54,150.88 L60.54,215 L18.33,215 L18.33,44.16 C18.33,41.67 17.53,40.89 15.07,40.89 L0.55,40.89 L0.55,3.47 L35.97,3.47 C52.28,3.47 56.46,11.77 57.25,18.17 C63.87,10.75 77.59,0 101.3,0 Z'
          id={pathId}
        />
      </defs>
      <g
        id='Pipedrive_letter_logo_dark'
        stroke='none'
        strokeWidth='1'
        fill='none'
        fillRule='evenodd'
      >
        <g transform='translate(67, 44)'>
          <use fill='currentColor' xlinkHref={`#${pathId}`} />
        </g>
      </g>
    </svg>
  )
}

export function CalendlyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='169.28 46.16 502.57 502.57' xmlns='http://www.w3.org/2000/svg'>
      <path
        fill='#006bff'
        d='M505.27,365.28c-14.79,12.86-33.19,28.86-66.71,28.86h-20.01c-24.22,0-46.25-8.62-62.01-24.28
	c-15.39-15.3-23.89-36.22-23.89-58.94v-26.87c0-22.72,8.48-43.66,23.89-58.94c15.77-15.66,37.79-24.28,62.01-24.28h20.01
	c33.51,0,51.92,16,66.71,28.86c15.34,13.34,28.59,24.86,63.89,24.86c5.48,0,10.86-0.43,16.09-1.26c-0.04-0.11-0.08-0.2-0.12-0.3
	c-2.1-5.1-4.57-10.12-7.42-14.96l-23.6-40.1c-21.65-36.8-61.68-59.46-104.98-59.46h-47.21c-43.3,0-83.33,22.67-104.98,59.46
	l-23.6,40.1c-21.65,36.8-21.65,82.12,0,118.91l23.6,40.1c21.65,36.8,61.68,59.45,104.98,59.45h47.21
	c43.3,0,83.33-22.67,104.98-59.45l23.6-40.1c2.85-4.85,5.32-9.85,7.42-14.95c0.04-0.11,0.08-0.2,0.12-0.3
	c-5.23-0.83-10.59-1.26-16.09-1.26C533.87,340.42,520.61,351.94,505.27,365.28z'
      />
      <path
        fill='#006bff'
        d='M438.57,225.16h-20.01c-36.86,0-61.09,25.83-61.09,58.89v26.87c0,33.06,24.22,58.89,61.09,58.89h20.01
	c53.71,0,49.49-53.72,130.59-53.72c7.77,0,15.45,0.7,22.92,2.06c2.46-13.66,2.46-27.64,0-41.31c-7.48,1.36-15.15,2.06-22.92,2.06
	C488.06,278.89,492.28,225.16,438.57,225.16z'
      />
      <path
        fill='#006bff'
        d='M638.66,337.76c-13.85-10.02-29.74-16.56-46.59-19.64c-0.03,0.13-0.04,0.26-0.07,0.39
	c-1.44,7.87-3.69,15.62-6.77,23.14c14.22,2.26,27.32,7.5,38.52,15.55c-0.04,0.12-0.07,0.24-0.11,0.37
	c-6.46,20.57-16.2,39.96-28.93,57.6c-12.58,17.42-27.79,32.76-45.22,45.57c-36.18,26.62-79.27,40.68-124.63,40.68
	c-28.08,0-55.31-5.39-80.94-16.02c-24.75-10.27-46.99-24.98-66.11-43.73c-19.11-18.75-34.1-40.56-44.57-64.85
	c-10.83-25.14-16.33-51.85-16.33-79.4c0-27.55,5.5-54.26,16.33-79.4c10.47-24.28,25.46-46.1,44.57-64.85
	c19.11-18.75,41.35-33.45,66.11-43.73c25.62-10.63,52.85-16.02,80.94-16.02c45.36,0,88.45,14.06,124.63,40.68
	c17.43,12.82,32.63,28.15,45.22,45.57c12.73,17.65,22.47,37.04,28.93,57.6c0.04,0.13,0.08,0.25,0.11,0.37
	c-11.19,8.04-24.3,13.3-38.52,15.55c3.08,7.53,5.34,15.3,6.77,23.17c0.03,0.13,0.04,0.25,0.07,0.38
	c16.85-3.08,32.73-9.62,46.59-19.64c13.28-9.64,10.71-20.53,8.69-26.99C618.08,136.9,529.55,69.12,424.87,69.12
	c-128.55,0-232.75,102.22-232.75,228.32c0,126.1,104.21,228.32,232.75,228.32c104.68,0,193.21-67.79,222.48-161.05
	C649.38,358.29,651.96,347.41,638.66,337.76z'
      />
      <path
        fill='#0ae8f0'
        d='M585.25,253.26c-5.23,0.83-10.59,1.26-16.09,1.26c-35.29,0-48.55-11.52-63.89-24.86
	c-14.79-12.86-33.19-28.86-66.71-28.86h-20.01c-24.22,0-46.25,8.62-62.01,24.28c-15.39,15.3-23.89,36.22-23.89,58.94v26.87
	c0,22.72,8.48,43.66,23.89,58.94c15.77,15.66,37.79,24.28,62.01,24.28h20.01c33.51,0,51.92-16.01,66.71-28.86
	c15.34-13.34,28.59-24.86,63.89-24.86c5.48,0,10.86,0.43,16.09,1.26c3.08-7.52,5.32-15.28,6.77-23.14c0.03-0.13,0.04-0.26,0.07-0.39
	c-7.48-1.36-15.15-2.06-22.92-2.06c-81.1,0-76.88,53.72-130.59,53.72h-20.01c-36.86,0-61.09-25.83-61.09-58.89v-26.87
	c0-33.06,24.22-58.89,61.09-58.89h20.01c53.71,0,49.5,53.72,130.59,53.72c7.77,0,15.45-0.7,22.92-2.06
	c-0.03-0.13-0.04-0.25-0.07-0.38C590.59,268.56,588.33,260.8,585.25,253.26z'
      />
    </svg>
  )
}

export function STTIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='m15 16 2.54-7.33a1.02 1.02 1 0 1 1.93 0L22 16' />
      <path d='M15.7 14h5.61' />
      <path d='m2 16 4.04-9.69a.5.5 0 0 1 .923 0L11 16' />
      <path d='M3.3 13h6.39' />
    </svg>
  )
}

export function TTSIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M2 10v3' />
      <path d='M6 6v11' />
      <path d='M10 3v18' />
      <path d='M14 8v7' />
      <path d='M18 5v13' />
      <path d='M22 10v3' />
    </svg>
  )
}

export function VideoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='m16 13 5.22 3.48a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5' />
      <rect x='2' y='6' width='14' height='12' rx='2' />
    </svg>
  )
}

export function ZoomIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg' aria-hidden='true'>
      <rect x='2' y='6' width='14' height='12' rx='2.5' fill='currentColor' />
      <path d='M16 9 L22 6 V18 L16 15 Z' fill='currentColor' />
    </svg>
  )
}

export function SmtpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='30'
      height='24'
      viewBox='0 0 30 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M2.36 5.83L11.77 12.11C13.07 12.97 13.71 13.4 14.42 13.57C15.04 13.72 15.68 13.72 16.3 13.57C17 13.4 17.65 12.97 18.95 12.11L28.36 5.83M8.83 21.72H21.89C24.15 21.72 25.28 21.72 26.15 21.28C26.91 20.89 27.53 20.27 27.92 19.51C28.36 18.65 28.36 17.52 28.36 15.25V7.97C28.36 5.71 28.36 4.57 27.92 3.71C27.53 2.95 26.91 2.33 26.15 1.94C25.28 1.5 24.15 1.5 21.89 1.5H8.83C6.56 1.5 5.43 1.5 4.57 1.94C3.81 2.33 3.19 2.95 2.8 3.71C2.36 4.57 2.36 5.71 2.36 7.97V15.25C2.36 17.52 2.36 18.65 2.8 19.51C3.19 20.27 3.8 20.89 4.57 21.28C5.43 21.72 6.56 21.72 8.83 21.72Z'
        stroke='currentColor'
        strokeWidth='2.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function McpIcon(props: SVGProps<SVGSVGElement>) {
  const id = useId()
  const clipId = `mcp_clip_${id}`

  return (
    <svg
      {...props}
      width='16'
      height='16'
      viewBox='0 0 16 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <g clipPath={`url(#${clipId})`}>
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M14.56 7.88L14.5 7.93L8.7 13.62C8.68 13.64 8.67 13.66 8.66 13.68C8.65 13.7 8.64 13.72 8.64 13.75C8.64 13.77 8.65 13.8 8.66 13.82C8.67 13.84 8.68 13.86 8.7 13.88L8.7 13.88L9.89 15.05C9.99 15.15 10.05 15.29 10.06 15.44C10.06 15.58 10 15.72 9.9 15.83L9.89 15.84C9.78 15.94 9.64 16 9.49 16C9.34 16 9.2 15.94 9.09 15.84L7.9 14.67C7.77 14.55 7.68 14.41 7.61 14.25C7.54 14.09 7.51 13.92 7.51 13.75C7.51 13.58 7.54 13.41 7.61 13.25C7.68 13.1 7.77 12.95 7.9 12.83L13.7 7.14C14.01 6.84 14.19 6.42 14.2 5.98C14.2 5.55 14.04 5.13 13.73 4.81L13.7 4.78L13.67 4.75C13.35 4.44 12.91 4.26 12.47 4.26C12.02 4.26 11.58 4.44 11.26 4.75L6.48 9.44H6.48L6.41 9.5C6.31 9.61 6.16 9.67 6.01 9.67C5.86 9.67 5.72 9.61 5.61 9.5C5.51 9.4 5.45 9.26 5.45 9.12C5.44 8.97 5.5 8.83 5.6 8.73L5.61 8.72L10.46 3.96C11.11 3.32 11.12 2.28 10.49 1.63L10.46 1.6C10.14 1.29 9.7 1.11 9.25 1.11C8.81 1.11 8.37 1.29 8.05 1.6L1.64 7.9C1.53 8 1.38 8.06 1.23 8.06C1.08 8.06 0.94 8 0.83 7.9C0.73 7.79 0.67 7.66 0.67 7.51C0.67 7.36 0.72 7.22 0.82 7.12L0.83 7.11L7.25 0.81C7.79 0.29 8.51 0 9.26 0C10 0 10.72 0.29 11.26 0.81C11.89 1.43 12.19 2.3 12.06 3.17C12.94 3.05 13.83 3.34 14.47 3.96L14.5 3.99C14.76 4.25 14.97 4.54 15.11 4.88C15.25 5.21 15.33 5.56 15.33 5.92C15.34 6.28 15.27 6.64 15.14 6.98C15.01 7.31 14.81 7.62 14.56 7.87M12.87 6.32C12.97 6.22 13.03 6.08 13.03 5.94C13.03 5.79 12.98 5.65 12.88 5.55L12.87 5.54C12.76 5.43 12.61 5.37 12.46 5.37C12.31 5.37 12.17 5.43 12.06 5.54L7.32 10.19C7 10.5 6.56 10.68 6.11 10.68C5.66 10.68 5.23 10.5 4.91 10.19C4.76 10.04 4.63 9.86 4.55 9.66C4.46 9.46 4.42 9.25 4.41 9.03C4.41 8.81 4.45 8.6 4.53 8.4C4.61 8.2 4.73 8.01 4.88 7.86L4.91 7.83L9.66 3.17C9.76 3.07 9.82 2.93 9.82 2.79C9.83 2.64 9.77 2.5 9.67 2.4L9.66 2.39C9.55 2.28 9.41 2.22 9.26 2.22C9.11 2.22 8.96 2.28 8.86 2.39L4.11 7.04C3.85 7.3 3.64 7.6 3.49 7.94C3.35 8.28 3.28 8.64 3.28 9.01C3.28 9.38 3.35 9.74 3.49 10.08C3.64 10.41 3.85 10.72 4.11 10.98C4.65 11.5 5.36 11.79 6.11 11.79C6.86 11.79 7.58 11.5 8.12 10.98L12.87 6.32Z'
          fill='currentColor'
        />
      </g>
      <defs>
        <clipPath id={clipId}>
          <rect width='16' height='16' fill='white' />
        </clipPath>
      </defs>
    </svg>
  )
}

export function WordpressIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns='http://www.w3.org/2000/svg' viewBox='0 0 25.93 25.93'>
      <g fill='currentColor'>
        <path d='M1.84,12.96c0,4.4,2.56,8.21,6.27,10.01L2.81,8.44C2.19,9.82,1.84,11.35,1.84,12.96z M20.47,12.4c0-1.37-0.49-2.33-0.92-3.07c-0.56-0.92-1.09-1.69-1.09-2.61c0-1.02,0.78-1.97,1.87-1.97c0.05,0,0.1,0.01,0.14,0.01c-1.98-1.81-4.61-2.92-7.51-2.92c-3.88,0-7.3,1.99-9.29,5.01c0.26,0.01,0.51,0.01,0.72,0.01c1.16,0,2.96-0.14,2.96-0.14c0.6-0.04,0.67,0.85,0.07,0.92c0,0-0.6,0.07-1.27,0.11l4.05,12.05l2.43-7.3l-1.73-4.75c-0.6-0.04-1.17-0.1-1.17-0.1c-0.6-0.04-0.53-0.95,0.07-0.92c0,0,1.84,0.14,2.93,0.14c1.16,0,2.96-0.14,2.96-0.14c0.6-0.04,0.67,0.85,0.07,0.92c0,0-0.6,0.07-1.27,0.11l4.02,11.95l1.11-3.71C20.19,14.55,20.47,13.35,20.47,12.4z M13.16,13.94l-3.34,9.69c1,0.29,2.05,0.45,3.14,0.45c1.29,0,2.54-0.22,3.69-0.63c-0.03-0.05-0.06-0.1-0.08-0.15L13.16,13.94z M22.72,7.63c0.05,0.35,0.08,0.73,0.08,1.14c0,1.13-0.21,2.4-0.85,3.98l-3.4,9.82c3.31-1.93,5.53-5.51,5.53-9.61C24.08,11.03,23.59,9.21,22.72,7.63z' />
        <path d='M0,12.96c0,7.15,5.82,12.96,12.96,12.96c7.15,0,12.96-5.82,12.96-12.96S20.11,0,12.96,0S0,5.81,0,12.96z M0.59,12.96c0-6.82,5.55-12.37,12.37-12.37s12.37,5.55,12.37,12.37S19.78,25.33,12.96,25.33S0.59,19.78,0.59,12.96z' />
      </g>
    </svg>
  )
}

export function ShopifyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 48 48'
      width='48px'
      height='48px'
    >
      <path
        fill='#7cb342'
        d='M37.22,11.78c-0.02-0.21-0.21-0.3-0.35-0.3s-3.21-0.23-3.21-0.23s-2.13-2.13-2.39-2.34	c-0.23-0.23-0.68-0.16-0.87-0.12c-0.02,0-0.47,0.14-1.19,0.38c-0.73-2.09-1.97-3.98-4.19-3.98h-0.21	C24.19,4.38,23.39,4,22.74,4c-5.15,0-7.64,6.44-8.41,9.73c-2.01,0.63-3.44,1.05-3.61,1.13	c-1.12,0.35-1.15,0.38-1.29,1.43c-0.12,0.8-3.05,23.46-3.05,23.46L29.18,44l12.37-2.67	C41.58,41.28,37.24,11.99,37.22,11.78z M27.94,9.48c-0.56,0.16-1.24,0.38-1.92,0.61V9.67	c0-1.26-0.16-2.3-0.47-3.12C26.72,6.7,27.45,7.98,27.94,9.48L27.94,9.48z M24.12,6.81	c0.31,0.8,0.52,1.92,0.52,3.47v0.23c-1.26,0.4-2.6,0.8-3.98,1.24C21.42,8.8,22.9,7.35,24.12,6.81	L24.12,6.81z M22.62,5.36c0.23,0,0.47,0.09,0.66,0.23c-1.66,0.77-3.42,2.72-4.15,6.66	c-1.1,0.35-2.16,0.66-3.16,0.98C16.81,10.23,18.92,5.36,22.62,5.36z'
      />
      <path
        fill='#558b2f'
        d='M36.87,11.43c-0.14,0-3.21-0.23-3.21-0.23s-2.13-2.13-2.39-2.34	C31.17,8.76,31.05,8.71,30.96,8.71L29.25,44l12.37-2.67c0,0-4.33-29.34-4.36-29.55	C37.17,11.57,37.01,11.48,36.87,11.43z'
      />
      <path
        fill='#fff'
        d='M24.79,18.59l-1.47,4.45c0,0-1.34-0.71-2.93-0.71c-2.37,0-2.49,1.5-2.49,1.87	c0,2.03,5.3,2.81,5.3,7.58c0,3.76-2.37,6.18-5.58,6.18c-3.87,0-5.81-2.4-5.81-2.4l1.04-3.41	c0,0,2.03,1.75,3.73,1.75c1.13,0,1.59-0.88,1.59-1.52c0-2.65-4.33-2.77-4.33-7.14c0-3.66,2.63-7.21,7.95-7.21	C23.78,17.99,24.79,18.59,24.79,18.59z'
      />
    </svg>
  )
}

export function GitlabIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns='http://www.w3.org/2000/svg' viewBox='0 0 380 380'>
      <path
        fill='#e24329'
        d='M265.26,174.37l-.213-.558-21.2-55.31c-.424-1.08-1.19-2-2.18-2.63-.988-.634-2.15-.933-3.32-.87-1.17.06-2.29.49-3.21,1.22-.91.74-1.57,1.73-1.87,2.85l-14.31,43.81h-57.91l-14.31-43.81c-.309-1.12-.965-2.12-1.87-2.85-.916-.729-2.04-1.16-3.21-1.22-1.18-.062-2.33.24-3.32.87-.992.63-1.75,1.54-2.18,2.63l-21.2,55.31-.213.55c-6.28,16.39-.929,34.91,13.06,45.49.26.2.49.4.76.06l.187.14,32.29,24.17,15.97,12.09,9.72,7.35c2.34,1.77,5.58,1.77,7.92,0l9.72-7.35,15.97-12.09,32.48-24.32c.03-.23.06-.427.09-.066,13.98-10.58,19.33-29.1,13.05-45.48Z'
      />
      <path
        fill='#fc6d26'
        d='M265.26,174.37l-.213-.558c-10.52,2.16-20.2,6.61-28.5,12.82-.135.1-25.2,19.06-46.55,35.2,15.85,11.99,29.65,22.4,29.65,22.4l32.48-24.32c.03-.23.06-.427.09-.066,13.98-10.58,19.33-29.1,13.05-45.48Z'
      />
      <path
        fill='#fca326'
        d='M160.35,244.23l15.97,12.09,9.72,7.35c2.34,1.77,5.58,1.77,7.92,0l9.72-7.35,15.97-12.09s-13.8-10.42-29.65-22.4c-15.85,11.99-29.65,22.4-29.65,22.4Z'
      />
      <path
        fill='#fc6d26'
        d='M143.45,186.63c-8.29-6.2-17.97-10.66-28.5-12.81l-.213.55c-6.28,16.39-.929,34.91,13.06,45.49.26.2.49.4.76.06l.187.14,32.29,24.17s13.8-10.42,29.65-22.4c-21.35-16.14-46.42-35.1-46.55-35.2Z'
      />
    </svg>
  )
}

export function DatabricksIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 241 266' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        d='M228.09 109.65L120.62 171.67L5.53 105.41L0 108.48V156.58L120.62 225.91L228.09 164.13V189.6L120.62 251.62L5.53 185.35L0 188.42V196.67L120.62 266L241 196.67V148.56L235.47 145.5L120.62 211.53L12.91 149.74V124.28L120.62 186.06L241 116.73V69.33L235 65.79L120.62 131.59L18.45 73.1L120.62 14.38L204.56 62.73L211.94 58.48V52.59L120.62 0L0 69.33V76.88L120.62 146.21L228.09 84.19V109.65Z'
        fill='#FF3621'
      />
    </svg>
  )
}

export function RssIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M4 11C6.39 11 8.68 11.95 10.36 13.64C12.05 15.32 13 17.61 13 20'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M4 4C8.24 4 12.31 5.69 15.31 8.69C18.31 11.69 20 15.76 20 20'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <circle cx='5' cy='19' r='1' fill='currentColor' />
    </svg>
  )
}

export function GranolaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox='34.168 33.75 1239.909 1282.5'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        fill='currentColor'
        d='M1033.77,1021.55c-21.6,24.24 -40.11,38.92 -50.31,45.93 c-4.8,3.19 -7.8,7.65 -11.99,11.48 c-22.2,19.14 -46.26,24.83 -63.06,38.23 c-22.8,17.86 -107.98,39.1 -132.18,46.54 c-40.96,9.31 -87.03,12.67 -137.43,10.75c-10.91,0 -20.99 0 -30.26 -0.73 c-3.76 -0.29 -7.54,0.68 -11.31,0.72c-0.15,0 -0.29,0 -0.42,0 c-0.4,0 -1.07 -0.29 -2.01 -0.86c-1.06 -0.65 -2.26 -1.06 -3.51 -1.06 c-0.33,0 -0.65 -0.03 -0.97 -0.07c-5.08 -0.7 -7.78,1.09 -9.73,2.08 c-1.48,0.75 -3.09,0.12 -4.49 -0.77c-4.43 -2.81 -14.32 -9.14 -17.68 -10.16 c-3.32 -1.01 -3.64,0.37 -5.41,0.68c-1.18,0.21 -2.41 -0.21 -3.3 -1.01 c-0.99 -0.9 -2.06 -2.2 -4.5 -3.5c-4.49 -2.39 -6.88,3.04 -13.55 -3.03 c-0.97 -0.88 -1.54 -2.61 -2.85 -2.7c-0.33 -0.02 -0.56 -0.04 -0.89 -0.1 c-6.72 -1.3 -18.92 -3.8 -27.12 -6.29c-9.6 -2.55 -6.61 -4.46 -10.81 -6.37 c-56.4 -21.05 -136.79 -62.52 -166.19 -91.86 c-10.8 -10.84 -23.4 -35.72 -31.2 -42.1 c-6 -5.1 -18 -15.31 -21 -20.41c-2.4 -4.47 0 -12.75 -4.2 -18.49 c-5.4 -7.02 -16.2 -10.85 -26.4 -26.79 c-11.4 -17.86 -18 -41.46 -29.4 -65.7 C202,854.91,175,786.02,175,660.36c0 -84.2,39 -200.93,55.8 -216.88 c10.8 -10.21,9.6 -32.53,17.39 -43.37 c89.01 -123.75,244.8 -214.79,430.2 -224.35 c7.53 -0.39,15.07 -0.63,22.62 -0.72c45.74 -0.53,91.58,4.47,136.04,15.31 c44.41,10.83,86.87,27.73,128.26,46.95c0,0,4.91,0.39,6.21,1.03 c2.16,1.06,3.07,2.99,5.23,4.06c2.16,1.06,5.28,0.16,7.64,0.64 c7.77,1.59,9.17,6.21,10.6,8.05c1.74,2.23,3.83,3.09,7.78,4.22 c10.31,2.96,11.67,6.37,13.07,7.94c1.12,1.25,1.61,2.88,2.17,4.34 c0.57,1.48,1.7,2.84,3.28,3.21c3.42,0.8,8.06,4.98,9.02,10.69 c0.63,3.72,4.65,5.32,3.55,12.3c-0.36,2.26,2.05,5.6 -10.6,18.07 s-39.18,20.33 -55.34,14.14c-55.85 -21.41 -64.13 -25.53 -86.57 -31.65 c-40.96 -11.17 -75.85 -18.76 -118.36 -17.96 c-67.8,1.28 -121.21,7.66 -185.41,29.98 c-28.14,9.97 -81.27,37.11 -107.93,58.24 c-26.66,21.13 -65.26,50.32 -81.19,77.33 c-5.58,9.46 -11.86,18.5 -25.06,33.17 c-19.2,21.05 -41.42,81.93 -48.62,111.28 c-1.8,6.38,2.99,13.4,0.59,19.78c-2.4,7.02 -13.8,10.21 -15,15.95 c-4.8,20.41 -3.6,46.56 -3.6,68.88c0,12.12,3.6,28.7,7.8,38.27 c3,6.38,12.6,10.85,13.8,17.22c0.6,4.46 -5.39,9.56 -5.4,13.39 c0,3.19,5.39,46.57,8.39,52.95c4.2,7.65,17.4,17.22,21,26.15 c2.4,6.38 -4.21,12.76,0.59,19.14c3,3.83,12.61,3.82,16.21,8.92 c4.8,6.38,15,24.87,19.8,30.62c3.6,4.47,10.2,6.39,13.2,8.3 c9,6.38,1.2,12.11,9.6,21.68c26.4,29.98,67.2,66.98,106.2,83.57 c6.02,2.56,67.75,26.13,71.39,26.15 c87,12.83,184.84,11.63,269.44 -35.58 c19.8 -10.85,131.97 -88.81,150.57 -181.3 c4.2 -18.5,9.6 -63.16,7.2 -81.02 c-9.6 -66.34 -50.48 -161.76 -125.41 -197.09 c-39.91 -18.82 -70.2 -18.5 -78 -17.22 c-22.8,4.46 -30.6 -8.93 -51.6 -7.02 c-64.2,5.1 -127.2,22.97 -176.4,74.63 c-45,47.84 -54.01,109.08 -31.21,147.99 c2.4,5.1,1.2,11.48 -3.6,14.67c-2.1,1.28 -4.05,2.87 -4.95,4.55 c-1.79,3.33,3.39,5.11,6.95,6.36c24.96,8.73,33.96,50.84,67,49.06 h7.2c0,0,13.8 0,19.2 -6.38c4.44 -5.24,4.42 -11.35,1.27 -14.06 c-1.4 -1.21 -3.18 -1.93 -3.59 -3.74c-0.45 -1.99 -0.68 -4.61 -0.68 -5.79 c0 -1.28,1.8 -1.92,1.8 -3.2c0 -3.83 -4.2 -7.01 -3.6 -10.84 c0.38 -2.04,3.21 -4.85,5.21 -6.96c1.52 -1.6,1.54 -3.63,0.55 -5.6 c-0.04 -0.07 -0.07 -0.14 -0.11 -0.21c-0.96 -1.97 -1.14 -4.32 -0.49 -6.41 c0.38 -1.2,0.83 -2.49,0.83 -3.78c0.6 -5.74 -1.79 -8.29 -2.39 -12.76 c0 -1.58,8.54 -5.32,11.56 -7.66c0.89 -0.69,0.98 -1.84,0.69 -2.93 c-0.62 -2.32 -1.45 -3.03 -1.45 -7.27c0 -1.02,0.86 -2.44,1.89 -3.79 c2.08 -2.71,4 -5.6,4.94 -8.88l1.66 -5.79 c0.69 -2.42,2.53 -4.34,4.92 -5.15c4.13 -1.39,2.22 -8.13,6.16 -10.01 c1.15 -0.55,4.02,0.15,8.63 -0.83c9.59 -1.91,3 -5.1,4.8 -10.21 c0.84 -3.12,3.44 -2.81,5.96 -2.56c2.02,0.2,3.98 -0.46,5.43 -1.88 c1.43 -1.39,2.87 -3.02,4.81 -3.85c2.43 -1.03,8.81 -1.23,13.38 -1.27 c1.88 -0.02,3.74 -0.29,5.61 -0.51c5.1 -0.6,12.33 -0.24,15.82 -0.77 c4.2 -0.64,6.6 -4.47,10.19 -4.47c3,0,7.21,5.1,10.21,5.1 c3 0,6 -2.55,9 -2.55c1.8,0,2.4,3.19,5.4,3.19 h1.2c0,0,27.6,0.64,56.4,18.49c19.8,12.12,34.2,41.47,34.2,41.47 c13.8,23.6 -1.51,47.86 -1.51,69.55c0,8.93,3,16.58,1.2,24.88 c-1.2,6.38 -6,11.49 -7.8,16.59c-1.8,4.46 -1.79,10.21 -7.79,18.49 c-4.8,7.02 -7.21,7.01 -8.41,8.29c-1.8,1.91 -17.34,25.41 -27.54,34.34 c-27,24.24 -51.96,31.34 -88.56,31.97c-16.2,0.64 -18,3.83 -20.4,3.83 c-8.4,0.64 -46.79 -1.27 -58.8 -3.19c0,0 -53.4 -10.21 -74.4 -20.41 c-11.4 -5.1 -86.41 -60.6 -103.21 -91.86 c-52.2 -98.23 -40.2 -202.84,13.8 -273.01 c39 -51.03,103.2 -117.37,255.59 -130.13 c77.4 -6.38,146.41,3.83,200.41,29.35 c76.2,35.72,132,98.87,166.8,173.5 C1154.8,743.28,1151.37,887.6,1033.77,1021.55z'
      />
    </svg>
  )
}

export function FirefliesIcon(props: SVGProps<SVGSVGElement>) {
  const id = useId()
  const g1 = `fireflies_g1_${id}`
  const g2 = `fireflies_g2_${id}`
  const g3 = `fireflies_g3_${id}`
  const g4 = `fireflies_g4_${id}`
  const g5 = `fireflies_g5_${id}`
  const g6 = `fireflies_g6_${id}`
  const g7 = `fireflies_g7_${id}`
  const g8 = `fireflies_g8_${id}`

  return (
    <svg {...props} xmlns='http://www.w3.org/2000/svg' viewBox='-6 -6 68 68'>
      <defs>
        <linearGradient
          id={g1}
          gradientUnits='userSpaceOnUse'
          x1='144.66'
          y1='-133.78'
          x2='54.38'
          y2='-38.92'
          gradientTransform='matrix(0.86 0 0 -0.86 -79.24 -68.17)'
        >
          <stop offset='0' stopColor='#E82A73' />
          <stop offset='0.11' stopColor='#DE2D7A' />
          <stop offset='0.3' stopColor='#C5388F' />
          <stop offset='0.54' stopColor='#9B4AB0' />
          <stop offset='0.82' stopColor='#6262DE' />
          <stop offset='0.99' stopColor='#3B73FF' />
        </linearGradient>
        <linearGradient
          id={g2}
          gradientUnits='userSpaceOnUse'
          x1='145.17'
          y1='-133.31'
          x2='54.88'
          y2='-38.45'
          gradientTransform='matrix(0.86 0 0 -0.86 -79.24 -68.17)'
        >
          <stop offset='0' stopColor='#FF3C82' />
          <stop offset='0.1' stopColor='#F53E88' />
          <stop offset='0.27' stopColor='#DC4598' />
          <stop offset='0.49' stopColor='#B251B2' />
          <stop offset='0.75' stopColor='#7961D7' />
          <stop offset='0.99' stopColor='#3B73FF' />
        </linearGradient>
        <linearGradient
          id={g3}
          gradientUnits='userSpaceOnUse'
          x1='144.76'
          y1='-123.2'
          x2='114.17'
          y2='-12.34'
          gradientTransform='matrix(0.86 0 0 -0.86 -79.24 -68.17)'
        >
          <stop offset='0' stopColor='#E82A73' />
          <stop offset='0.11' stopColor='#DE2D7A' />
          <stop offset='0.3' stopColor='#C5388F' />
          <stop offset='0.54' stopColor='#9B4AB0' />
          <stop offset='0.82' stopColor='#6262DE' />
          <stop offset='0.99' stopColor='#3B73FF' />
        </linearGradient>
        <linearGradient
          id={g4}
          gradientUnits='userSpaceOnUse'
          x1='134.82'
          y1='-132.33'
          x2='25.31'
          y2='-98.96'
          gradientTransform='matrix(0.86 0 0 -0.86 -79.24 -68.17)'
        >
          <stop offset='0' stopColor='#E82A73' />
          <stop offset='0.11' stopColor='#DE2D7A' />
          <stop offset='0.3' stopColor='#C5388F' />
          <stop offset='0.54' stopColor='#9B4AB0' />
          <stop offset='0.82' stopColor='#6262DE' />
          <stop offset='0.99' stopColor='#3B73FF' />
        </linearGradient>
        <linearGradient
          id={g5}
          gradientUnits='userSpaceOnUse'
          x1='82.21'
          y1='-52.79'
          x2='112.88'
          y2='-123.08'
          gradientTransform='matrix(0.86 0 0 -0.86 -79.24 -68.17)'
        >
          <stop offset='0' stopColor='#E82A73' />
          <stop offset='0.11' stopColor='#DE286E' />
          <stop offset='0.3' stopColor='#C52361' />
          <stop offset='0.54' stopColor='#9B1A4D' />
          <stop offset='0.83' stopColor='#620F30' />
          <stop offset='0.99' stopColor='#3D081E' />
        </linearGradient>
        <linearGradient
          id={g6}
          gradientUnits='userSpaceOnUse'
          x1='107.65'
          y1='-78.53'
          x2='138.33'
          y2='-148.82'
          gradientTransform='matrix(0.86 0 0 -0.86 -79.24 -68.17)'
        >
          <stop offset='0' stopColor='#E82A73' />
          <stop offset='0.11' stopColor='#DE286E' />
          <stop offset='0.3' stopColor='#C52361' />
          <stop offset='0.54' stopColor='#9B1A4D' />
          <stop offset='0.83' stopColor='#620F30' />
          <stop offset='0.99' stopColor='#3D081E' />
        </linearGradient>
        <linearGradient
          id={g7}
          gradientUnits='userSpaceOnUse'
          x1='70.83'
          y1='-99.32'
          x2='140.3'
          y2='-145.47'
          gradientTransform='matrix(0.86 0 0 -0.86 -79.24 -68.17)'
        >
          <stop offset='0' stopColor='#E82A73' />
          <stop offset='0.11' stopColor='#DE286E' />
          <stop offset='0.3' stopColor='#C52361' />
          <stop offset='0.54' stopColor='#9B1A4D' />
          <stop offset='0.83' stopColor='#620F30' />
          <stop offset='0.99' stopColor='#3D081E' />
        </linearGradient>
        <linearGradient
          id={g8}
          gradientUnits='userSpaceOnUse'
          x1='297.69'
          y1='-1360.89'
          x2='309.59'
          y2='-1454.88'
          gradientTransform='matrix(0.86 0 0 -0.86 -79.24 -68.17)'
        >
          <stop offset='0' stopColor='#E82A73' />
          <stop offset='0.11' stopColor='#DE286E' />
          <stop offset='0.3' stopColor='#C52361' />
          <stop offset='0.54' stopColor='#9B1A4D' />
          <stop offset='0.83' stopColor='#620F30' />
          <stop offset='0.99' stopColor='#3D081E' />
        </linearGradient>
      </defs>
      <g>
        <path fill={`url(#${g1})`} d='M18.4,0H0v18.3h18.4V0z' />
        <path fill={`url(#${g2})`} d='M40.2,22.1H21.8v18.3h18.4V22.1z' />
        <path
          fill={`url(#${g3})`}
          d='M40.2,0H21.8v18.3H56v-2.6c0-4.2-1.7-8.1-4.6-11.1C48.4,1.7,44.4,0,40.2,0L40.2,0z'
        />
        <path
          fill={`url(#${g4})`}
          d='M0,22.1v18.3c0,4.2,1.7,8.1,4.6,11.1c3,2.9,7,4.6,11.2,4.6h2.6V22.1H0z'
        />
        <path fill={`url(#${g5})`} opacity='0.18' d='M0,0l18.4,18.3H0V0z' />
        <path fill={`url(#${g6})`} opacity='0.18' d='M21.8,22.1l18.4,18.3H21.8V22.1z' />
        <path
          fill={`url(#${g7})`}
          opacity='0.18'
          d='M0,40.3c0,4.2,1.7,8.1,4.6,11.1c3,2.9,7,4.6,11.2,4.6h2.6V22.1L0,40.3z'
        />
        <path
          fill={`url(#${g8})`}
          opacity='0.18'
          d='M40.2,0c4.2,0,8.2,1.7,11.2,4.6c3,2.9,4.6,6.9,4.6,11.1v2.6H21.8L40.2,0z'
        />
      </g>
    </svg>
  )
}

export function LabbaiTriggerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox='0 0 222 222'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
    >
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M107.822 93.76C107.822 97.35 106.403 100.792 103.884 103.328L103.523 103.692C101.006 106.236 97.59 107.658 94.02 107.658H13.45C6.02 107.658 0 113.718 0 121.191V208.332C0 215.806 6.02 221.866 13.45 221.866H99.96C107.383 221.866 113.4 215.806 113.4 208.332V126.745C113.4 123.419 114.71 120.228 117.047 117.874C119.377 115.527 122.546 114.207 125.849 114.207H207.777C215.198 114.207 221.214 108.148 221.214 100.674V13.53C221.214 6.06 215.198 0 207.777 0H121.26C113.839 0 107.822 6.06 107.822 13.53V93.76ZM134.078 18.55H194.952C199.289 18.55 202.796 22.09 202.796 26.45V87.76C202.796 92.12 199.289 95.66 194.952 95.66H134.078C129.748 95.66 126.233 92.12 126.233 87.76V26.45C126.233 22.09 129.748 18.55 134.078 18.55Z'
        fill='currentColor'
      />
      <path
        d='M207.878 129.57H143.554C135.756 129.57 129.434 135.937 129.434 143.791V207.784C129.434 215.638 135.756 222.005 143.554 222.005H207.878C215.677 222.005 221.999 215.638 221.999 207.784V143.791C221.999 135.937 215.677 129.57 207.878 129.57Z'
        fill='currentColor'
      />
    </svg>
  )
}

export function SimDeploymentsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox='0 0 222 222'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
    >
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M107.822 93.76C107.822 97.35 106.403 100.792 103.884 103.328L103.523 103.692C101.006 106.236 97.59 107.658 94.02 107.658H13.45C6.02 107.658 0 113.718 0 121.191V208.332C0 215.806 6.02 221.866 13.45 221.866H99.96C107.383 221.866 113.4 215.806 113.4 208.332V126.745C113.4 123.419 114.71 120.228 117.047 117.874C119.377 115.527 122.546 114.207 125.849 114.207H207.777C215.198 114.207 221.214 108.148 221.214 100.674V13.53C221.214 6.06 215.198 0 207.777 0H121.26C113.839 0 107.822 6.06 107.822 13.53V93.76ZM134.078 18.55H194.952C199.289 18.55 202.796 22.09 202.796 26.45V87.76C202.796 92.12 199.289 95.66 194.952 95.66H134.078C129.748 95.66 126.233 92.12 126.233 87.76V26.45C126.233 22.09 129.748 18.55 134.078 18.55Z'
        fill='#33C482'
      />
      <path
        d='M207.878 129.57H143.554C135.756 129.57 129.434 135.937 129.434 143.791V207.784C129.434 215.638 135.756 222.005 143.554 222.005H207.878C215.677 222.005 221.999 215.638 221.999 207.784V143.791C221.999 135.937 215.677 129.57 207.878 129.57Z'
        fill='#33C482'
      />
    </svg>
  )
}

export function CalComIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='101'
      height='22'
      viewBox='0 0 101 22'
      fill='currentColor'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M10.06 20.82C4.32 20.82 0 16.28 0 10.67C0 5.05 4.1 0.47 10.06 0.47C13.22 0.47 15.41 1.44 17.12 3.66L14.36 5.96C13.2 4.73 11.81 4.11 10.06 4.11C6.18 4.11 4.05 7.08 4.05 10.67C4.05 14.26 6.38 17.17 10.06 17.17C11.79 17.17 13.26 16.56 14.42 15.32L17.14 17.72C15.5 19.85 13.26 20.82 10.06 20.82Z'
        fill='currentColor'
      />
      <path
        d='M29.02 5.89H32.73V20.46H29.02V18.33C28.24 19.84 26.96 20.85 24.49 20.85C20.56 20.85 17.41 17.43 17.41 13.23C17.41 9.03 20.56 5.61 24.49 5.61C26.94 5.61 28.24 6.61 29.02 8.13V5.89ZM29.13 13.23C29.13 10.95 27.56 9.06 25.1 9.06C22.73 9.06 21.18 10.97 21.18 13.23C21.18 15.43 22.73 17.4 25.1 17.4C27.55 17.4 29.13 15.49 29.13 13.23Z'
        fill='currentColor'
      />
      <path d='M35.36 0H39.07V20.44H35.36V0Z' fill='currentColor' />
      <path
        d='M40.73 18.52C40.73 17.32 41.69 16.31 42.99 16.31C44.3 16.31 45.22 17.32 45.22 18.52C45.22 19.75 44.28 20.76 42.99 20.76C41.7 20.76 40.73 19.75 40.73 18.52Z'
        fill='currentColor'
      />
      <path
        d='M59.43 18.11C58.05 19.79 55.95 20.85 53.47 20.85C49.04 20.85 45.79 17.43 45.79 13.23C45.79 9.03 49.04 5.61 53.47 5.61C55.86 5.61 57.94 6.61 59.32 8.2L56.45 10.61C55.73 9.72 54.8 9.04 53.47 9.04C51.1 9.04 49.56 10.95 49.56 13.21C49.56 15.47 51.1 17.38 53.47 17.38C54.91 17.38 55.9 16.63 56.63 15.62L59.43 18.11Z'
        fill='currentColor'
      />
      <path
        d='M59.74 13.23C59.74 9.03 63 5.61 67.43 5.61C71.86 5.61 75.11 9.03 75.11 13.23C75.11 17.43 71.86 20.85 67.43 20.85C63 20.83 59.74 17.43 59.74 13.23ZM71.34 13.23C71.34 10.95 69.8 9.06 67.43 9.06C65.06 9.04 63.51 10.95 63.51 13.23C63.51 15.49 65.06 17.4 67.43 17.4C69.8 17.4 71.34 15.49 71.34 13.23Z'
        fill='currentColor'
      />
      <path
        d='M100.23 11.55V20.44H96.52V12.46C96.52 9.94 95.34 8.86 93.58 8.86C91.92 8.86 90.74 9.68 90.74 12.46V20.44H87.03V12.46C87.03 9.94 85.83 8.86 84.09 8.86C82.43 8.86 80.98 9.68 80.98 12.46V20.44H77.27V5.87H80.98V7.89C81.75 6.32 83.15 5.53 85.3 5.53C87.34 5.53 89.05 6.54 89.99 8.24C90.93 6.5 92.31 5.53 94.81 5.53C97.86 5.55 100.23 7.87 100.23 11.55Z'
        fill='currentColor'
      />
    </svg>
  )
}

export function GoogleMapsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns='http://www.w3.org/2000/svg' viewBox='0 0 92.3 132.3'>
      <path
        fill='#1a73e8'
        d='M60.2 2.2C55.8.8 51 0 46.1 0 32 0 19.3 6.4 10.8 16.5l21.8 18.3L60.2 2.2z'
      />
      <path
        fill='#ea4335'
        d='M10.8 16.5C4.1 24.5 0 34.9 0 46.1c0 8.7 1.7 15.7 4.6 22l28-33.3-21.8-18.3z'
      />
      <path
        fill='#4285f4'
        d='M46.2 28.5c9.8 0 17.7 7.9 17.7 17.7 0 4.3-1.6 8.3-4.2 11.4 0 0 13.9-16.6 27.5-32.7-5.6-10.8-15.3-19-27-22.7L32.6 34.8c3.3-3.8 8.1-6.3 13.6-6.3'
      />
      <path
        fill='#fbbc04'
        d='M46.2 63.8c-9.8 0-17.7-7.9-17.7-17.7 0-4.3 1.5-8.3 4.1-11.3l-28 33.3c4.8 10.6 12.8 19.2 21 29.9l34.1-40.5c-3.3 3.9-8.1 6.3-13.5 6.3'
      />
      <path
        fill='#34a853'
        d='M59.1 109.2c15.4-24.1 33.3-35 33.3-63 0-7.7-1.9-14.9-5.2-21.3L25.6 98c2.6 3.4 5.3 7.3 7.9 11.3 9.4 14.5 6.8 23.1 12.8 23.1s3.4-8.7 12.8-23.2'
      />
    </svg>
  )
}

export function AgentSkillsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns='http://www.w3.org/2000/svg'
      width='16'
      height='16'
      viewBox='0 0 16 16'
      fill='none'
    >
      <path
        d='M8 1L14.06 4.5V11.5L8 15L1.94 11.5V4.5L8 1Z'
        stroke='currentColor'
        strokeWidth='1.5'
        fill='none'
      />
      <path d='M8 4.5L11 6.25V9.75L8 11.5L5 9.75V6.25L8 4.5Z' fill='currentColor' />
    </svg>
  )
}

// ---- Competitor brand logos (sourced via Context.dev brand-intelligence API, 2026-07-02) ----

export function N8nIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'>
      <image
        href='data:image/png;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAQKADAAQAAAABAAAAQAAAAAD/4QnSaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLwA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/PiA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJYTVAgQ29yZSA2LjAuMCI+IDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+IDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnBob3Rvc2hvcD0iaHR0cDovL25zLmFkb2JlLmNvbS9waG90b3Nob3AvMS4wLyIgcGhvdG9zaG9wOkluc3RydWN0aW9ucz0iRkJNRDBhMDAwYWIyMDEwMDAwOTgwMzAwMDBmMTA0MDAwMDRhMDYwMDAwYTIwNjAwMDBiMTA3MDAwMDQ1MGEwMDAwMmUwYjAwMDBmOTBiMDAwMDMwMGMwMDAwOTgwZTAwMDAiLz4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8P3hwYWNrZXQgZW5kPSJ3Ij8+AP/tAK5QaG90b3Nob3AgMy4wADhCSU0EBAAAAAAAdhwBWgADGyVHHAIAAAIAAhwCKABiRkJNRDBhMDAwYWIyMDEwMDAwOTgwMzAwMDBmMTA0MDAwMDRh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'
        width='64'
        height='64'
      />
    </svg>
  )
}

export function ZapierIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'>
      <image
        href='data:image/png;base64,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'
        width='64'
        height='64'
      />
    </svg>
  )
}

export function MakeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'>
      <image
        href='data:image/png;base64,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'
        width='64'
        height='64'
      />
    </svg>
  )
}

export function GumloopIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'>
      <image
        href='data:image/png;base64,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'
        width='64'
        height='64'
      />
    </svg>
  )
}

export function WorkatoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'>
      <image
        href='data:image/png;base64,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'
        width='64'
        height='64'
      />
    </svg>
  )
}

export function PipedreamIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'>
      <image
        href='data:image/png;base64,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'
        width='64'
        height='64'
      />
    </svg>
  )
}

export function TinesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'>
      <image
        href='data:image/png;base64,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'
        width='64'
        height='64'
      />
    </svg>
  )
}

export function StackAIIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'>
      <image
        href='data:image/png;base64,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'
        width='64'
        height='64'
      />
    </svg>
  )
}

export function VellumIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 64 64' xmlns='http://www.w3.org/2000/svg'>
      <image
        href='data:image/png;base64,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'
        width='64'
        height='64'
      />
    </svg>
  )
}

export function RetoolIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 128 128' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        fill='#242424'
        d='M80.64 15.67C80.64 12.91 78.4 10.67 75.64 10.67H18.97C16.21 10.67 13.97 12.91 13.97 15.67V39C13.97 41.76 16.21 44 18.97 44H75.64C78.4 44 80.64 46.24 80.64 49V55.67C80.64 58.43 78.4 60.67 75.64 60.67H38.97C36.21 60.67 33.97 62.91 33.97 65.67V89C33.97 91.76 36.21 94 38.97 94H75.64C78.4 94 80.64 96.24 80.64 99V112.33C80.64 115.1 82.88 117.33 85.64 117.33H108.97C111.74 117.33 113.97 115.1 113.97 112.33V89C113.97 86.24 111.74 84 108.97 84H85.64C82.88 84 80.64 81.76 80.64 79V72.33C80.64 69.57 82.88 67.33 85.64 67.33H108.97C111.74 67.33 113.97 65.1 113.97 62.33V39C113.97 36.24 111.74 34 108.97 34H85.64C82.88 34 80.64 31.76 80.64 29V15.67Z'
      />
    </svg>
  )
}

export function LangflowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>
      <image
        href='data:image/png;base64,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'
        width='200'
        height='200'
      />
    </svg>
  )
}

export function FlowiseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'>
      <image
        href='data:image/png;base64,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'
        width='200'
        height='200'
      />
    </svg>
  )
}
