import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { isEnabled } from '@/config/features'

// Kill switch: zet 'donationButton' op false in src/config/features.ts
// of run: node scripts/toggle-feature.mjs donationButton false
// Dan verdwijnt deze knop uit alle schermen zonder verdere codewijziging.

interface DonationButtonProps {
  appName: string
  lightningAddress?: string
  amounts?: number[]
  className?: string
}

type State = 'idle' | 'open' | 'loading' | 'invoice' | 'paid' | 'error'

declare global {
  interface Window {
    webln?: {
      enable(): Promise<void>
      sendPayment(invoice: string): Promise<{ preimage: string }>
    }
    nostr?: {
      signEvent(event: NostrEventTemplate): Promise<NostrEvent>
    }
  }
}

interface NostrEventTemplate {
  kind: number
  content: string
  tags: string[][]
  created_at: number
}

interface NostrEvent extends NostrEventTemplate {
  id: string
  pubkey: string
  sig: string
}

const RELAY = 'wss://goosielabs.com/relay'

// Publiceert de stem als Nostr-event nadat betaling geslaagd is.
// Stemmen is altijd optioneel — als NIP-07 niet aanwezig is, stil overgeslagen.
async function publishVote(appName: string, sats: number): Promise<void> {
  if (!isEnabled('nostrVoting')) return
  if (typeof window === 'undefined' || !window.nostr) return
  try {
    const draft: NostrEventTemplate = {
      kind: 1,
      content: `⚡ ${sats} sats → ${appName} #glvote`,
      tags: [
        ['t', 'glvote'],
        ['app', appName],
        ['amount', String(sats)],
      ],
      created_at: Math.floor(Date.now() / 1000),
    }
    const signed = await window.nostr.signEvent(draft)
    const ws = new WebSocket(RELAY)
    ws.onopen = () => {
      ws.send(JSON.stringify(['EVENT', signed]))
      setTimeout(() => ws.close(), 3000)
    }
  } catch {
    // Stem publiceren is bijzaak — betaling is al geslaagd
  }
}

export function DonationButton({
  appName,
  lightningAddress = 'zoomer@getalby.com',
  amounts = [21, 100, 500, 2100],
  className,
}: DonationButtonProps) {
  // Feature flag — component rendert niet als donationButton uitstaat
  if (!isEnabled('donationButton')) return null

  const [state, setState] = useState<State>('idle')
  const [selectedAmount, setSelectedAmount] = useState(amounts[0])
  const [invoice, setInvoice] = useState('')
  const [copied, setCopied] = useState(false)

  async function handlePay(sats: number) {
    setState('loading')
    try {
      const [user, domain] = lightningAddress.split('@')
      const lnurlRes = await fetch(`https://${domain}/.well-known/lnurlp/${user}`)
      if (!lnurlRes.ok) throw new Error('LNURL ophalen mislukt')
      const lnurlData = await lnurlRes.json()

      const msats = sats * 1000
      const comment = encodeURIComponent(`${appName} — stem`)
      const callbackRes = await fetch(`${lnurlData.callback}?amount=${msats}&comment=${comment}`)
      if (!callbackRes.ok) throw new Error('Invoice aanvragen mislukt')
      const { pr } = await callbackRes.json()

      if (window.webln) {
        try {
          await window.webln.enable()
          await window.webln.sendPayment(pr)
          setState('paid')
          publishVote(appName, sats)
          return
        } catch {
          // webln geweigerd of niet beschikbaar — toon invoice handmatig
        }
      }

      setInvoice(pr)
      setState('invoice')
    } catch {
      setState('error')
    }
  }

  // Wanneer gebruiker de invoice handmatig kopieert/opent weten we niet zeker
  // of betaling geslaagd is — stem publiceren pas na bevestiging via webln.
  function copyInvoice() {
    navigator.clipboard.writeText(invoice)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function reset() {
    setState('open')
    setInvoice('')
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={() => setState('open')}
        title="Vind je dit leuk? Geef sats — direct, anoniem, via Lightning."
      >
        ⚡ Motiveer ons
      </Button>

      <Dialog open={state !== 'idle'} onOpenChange={(open) => !open && setState('idle')}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>⚡ Motiveer dit idee</DialogTitle>
            <DialogDescription>
              Doneren is stemmen. Elke sat zegt: dit idee vind ik waardevol.
            </DialogDescription>
          </DialogHeader>

          {state === 'open' && (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                {amounts.map((sats) => (
                  <Button
                    key={sats}
                    variant={selectedAmount === sats ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedAmount(sats)}
                  >
                    {sats} sats
                  </Button>
                ))}
              </div>
              <Button className="w-full" onClick={() => handlePay(selectedAmount)}>
                Geef {selectedAmount} sats aan {appName}
              </Button>
            </div>
          )}

          {state === 'loading' && (
            <p className="text-center text-muted-foreground py-4">Invoice aanvragen…</p>
          )}

          {state === 'invoice' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Kopieer de invoice en plak hem in je Lightning wallet.
              </p>
              <code className="block text-xs bg-muted rounded p-2 break-all max-h-24 overflow-auto">
                {invoice}
              </code>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={copyInvoice}>
                  {copied ? '✓ Gekopieerd' : 'Kopieer invoice'}
                </Button>
                <Button size="sm" variant="outline" className="flex-1" asChild>
                  <a href={`lightning:${invoice}`}>Open wallet</a>
                </Button>
              </div>
              <Button size="sm" variant="ghost" className="w-full" onClick={reset}>
                Ander bedrag
              </Button>
            </div>
          )}

          {state === 'paid' && (
            <div className="text-center py-4 space-y-2">
              <p className="text-2xl">⚡</p>
              <p className="font-medium">Bedankt! Jouw stem is geteld.</p>
              <p className="text-sm text-muted-foreground">
                {selectedAmount} sats → {appName}
              </p>
            </div>
          )}

          {state === 'error' && (
            <div className="text-center py-4 space-y-2">
              <p className="text-sm text-destructive">Invoice aanvragen mislukt.</p>
              <Button size="sm" variant="outline" onClick={reset}>
                Opnieuw proberen
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
