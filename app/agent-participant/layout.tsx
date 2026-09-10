import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Agent Participant Toolkit',
  description: 'Create and test custom agent participants',
}

export default function AgentParticipantLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return children
}
