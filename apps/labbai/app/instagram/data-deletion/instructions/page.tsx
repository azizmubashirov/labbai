import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { getBrandConfig } from '@/lib/branding'
import { LogoShell } from '@/app/_shell/logo-shell'

export const metadata: Metadata = {
  title: 'Instagram data deletion instructions',
  description: 'How to ask Labbai to delete the Instagram data its auto-replies store about you.',
}

interface SectionProps {
  title: string
  children: ReactNode
}

function Section({ title, children }: SectionProps) {
  return (
    <section className='flex flex-col gap-3'>
      <h2 className='text-[var(--text-primary)] text-xl'>{title}</h2>
      <div className='flex flex-col gap-3 text-[var(--text-body)] text-base leading-relaxed'>
        {children}
      </div>
    </section>
  )
}

const LINK_CLASS = 'text-[var(--text-primary)] underline underline-offset-2'

/**
 * Public data deletion instructions for the Meta app review (the "Data Deletion Instructions
 * URL" in the app settings). Static: it explains what Instagram Auto-Reply stores about connected
 * accounts and the people who interact with them, how each can have it deleted, and what a
 * request leaves to workspace deletion or support (Inbox conversations, workflow run logs). The
 * Meta callback is triggered by the account owner removing the app, so that path is described
 * for business accounts; commenters are pointed to support.
 */
export default function DataDeletionInstructionsPage() {
  const { supportEmail, privacyUrl } = getBrandConfig()

  return (
    <LogoShell theme='inherit'>
      <article className='mx-auto flex w-full max-w-[680px] flex-col gap-10 px-4 py-12'>
        <header className='flex flex-col gap-3'>
          <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
            Instagram data deletion
          </h1>
          <p className='text-[var(--text-muted)] text-lg'>
            Labbai is an AI workspace. Businesses connect their Instagram accounts to it to answer
            comments and messages automatically. This page explains what Labbai stores about you
            when you interact with one of those accounts, and how to have it deleted.
          </p>
        </header>

        <Section title='What Labbai stores'>
          <p>
            When you comment on a post or live video of a connected business account, reply to or
            mention its story, or tap a button in a message it sent you, Labbai may store:
          </p>
          <ul className='flex list-disc flex-col gap-1 pl-5'>
            <li>your Instagram user ID and, for comments, your username;</li>
            <li>the text of your comment or message, up to 1,000 characters;</li>
            <li>which post, live video, or story it was about;</li>
            <li>which replies were sent to you, and when;</li>
            <li>which links in those replies you tapped.</li>
          </ul>
          <p>
            For a connected business account, Labbai also stores the auto-reply rules set up for it.
            Labbai does not store your password, your email address, or your phone number. It keeps
            this data only so the business can see which replies went out.
          </p>
        </Section>

        <Section title='If you connected a business account'>
          <ol className='flex list-decimal flex-col gap-2 pl-5'>
            <li>
              Open Instagram and go to your settings. Find <strong>Apps and websites</strong>, then
              remove the app. Instagram then sends Labbai a deletion request for your account.
            </li>
            <li>
              Labbai deletes the account&apos;s auto-reply rules and every auto-reply record on it:
              the comments, messages, Instagram user IDs, usernames, and link taps listed above. You
              get a confirmation code and a link to a page that confirms the request.
            </li>
          </ol>
        </Section>

        <Section title='If you commented on or messaged a business'>
          {supportEmail ? (
            <p>
              Email{' '}
              <a href={`mailto:${supportEmail}`} className={LINK_CLASS}>
                {supportEmail}
              </a>{' '}
              with your Instagram username and ask us to delete your data. We delete the auto-reply
              records stored about you.
            </p>
          ) : (
            <p>
              Ask the business you talked to on Instagram to contact the Labbai team and request the
              deletion for you. We delete the auto-reply records stored about you.
            </p>
          )}
        </Section>

        <Section title='What a request does not cover'>
          <p>
            Inbox conversations and workflow run logs belong to the business&apos;s Labbai
            workspace. They are deleted when the business deletes its workspace, or when you ask our
            support team{supportEmail ? ' at the address above' : ''}.
          </p>
          <p>
            Deleting this data does not delete your comments or messages on Instagram itself. To
            remove those, delete them in Instagram.
          </p>
        </Section>

        {privacyUrl ? (
          <p className='text-[var(--text-muted)] text-base'>
            Read more in our{' '}
            <a href={privacyUrl} className={LINK_CLASS}>
              privacy policy
            </a>
            .
          </p>
        ) : null}
      </article>
    </LogoShell>
  )
}
