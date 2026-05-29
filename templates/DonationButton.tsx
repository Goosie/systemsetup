import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

// Sats doneren = stemmen op dit idee.
// Betaling gaat via Lightning (LNURL-pay). Als webln beschikbaar is (Alby extensie),
// betaalt de gebruiker direct. Anders krijgen ze een invoice om te kopiëren of te scannen.

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
  }
}

export function DonationButton({
  appName,
  lightningAddress = 'zoomer@getalby.com',
  amounts = [21, 100, 500, 2100],
  className,
}: DonationButtonProps) {
  const [state, setState] = useState<State>('idle')
  const [selectedAmount, setSelectedAmount] = useState(amounts[0])
  const [invoice, setInvoice] = useState('')
  const [copied, setCopied] = useState(false)
  const [totalVotes] = useState<number | null>(null)

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
        {totalVotes !== null && (
          <span className="ml-2 text-xs text-muted-foreground">{totalVotes} sats</span>
        )}
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
