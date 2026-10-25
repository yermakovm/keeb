/*
 * Copyright (c) 2025 The keeb keyboard authors
 *
 * SPDX-License-Identifier: MIT
 *
 * Transport contract.
 *
 * The firmware's side of this is `struct keeb_tlv_tx_dev`: one send hook plus
 * the largest fragment that hook accepts (keeb-module/transport/keeb_ble.c
 * sets it to CONFIG_BT_L2CAP_TX_MTU - 3). Fragmentation and reassembly live in
 * the codec, never in a transport, so a transport only has to move whole
 * packets in both directions and report the three failures the protocol cares
 * about.
 */

import type { SendPacket } from '../proto/tlv.ts'

export type TransportState = 'offline' | 'connecting' | 'connected' | 'error'

export interface KeebTransport {
  /** Shown in the UI: "mock keyboard" or the BLE device name. */
  readonly label: string

  /** Payload bytes per fragment this link can carry. */
  readonly maxFragment: number

  readonly state: TransportState

  /** `all` widens the chooser to every BLE device (BLE transport only). */
  connect(opts?: { all?: boolean }): Promise<void>
  disconnect(): void

  /** BLE only: reconnect to a device this origin was already granted, without a
   * chooser. Returns the label, or null when nothing saved is reachable.
   */
  connectSaved?(): Promise<string | null>

  /** BLE only: revoke this origin's saved Bluetooth grants; returns how many. */
  forget?(): Promise<number>

  /** The codec's send hook: 0 on success, else KEEB_TX_BUSY / KEEB_TX_MTU /
   * KEEB_TX_FAIL. */
  send: SendPacket

  /** Subscribe to complete packets as the link delivered them. */
  onPacket(handler: (pkt: Uint8Array) => void): () => void

  onState(handler: (state: TransportState, detail: string) => void): () => void

  /** The link turned out to carry a smaller fragment than `maxFragment` said.
   * The sender must then restart the message from offset 0 — which is what the
   * protocol's FIRST flag exists for — at the new size. */
  onShrink?(handler: (maxFragment: number) => void): () => void
}
