/**
 * Hippocampus web panels, browser half: contributes two conversation view
 * tabs (beside chat and trajectory) — the memory browser and the context
 * panel (compaction history + dreamer runs). Data arrives from the plugin's
 * read-only JSON API (`/plugins/hippocampus/api/*`), so the views issue plain
 * fetches and ignore the conversation snapshot machinery (a constant empty
 * view snapshot keeps the registry happy).
 *
 * The conversationViews service is awaited through a runtime ctx.inject()
 * rather than the fiber's static inject list: the view registry is provided
 * by the runtime plugin, which activates after this entry in dynamically
 * composed graphs, and the static wait never re-checks on late provides.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationViewBuilder, ConversationViewDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import { MemoryView } from './MemoryView.tsx'
import { ContextView } from './ContextView.tsx'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, NS, zh, type MemoryKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Project-memory browser copy. */
    'hippocampus': MemoryKey
  }
}

/** Required services: the slot registry and locale (available at boot). */
export const inject = ['slots', 'locale']

/**
 * The plugin views' snapshots are constants: their data lives in the plugin's
 * own store and arrives via fetch, not the conversation event stream.
 */
const EMPTY_SNAPSHOT = Object.freeze({})

/** A no-op builder satisfying the view registry contract. */
class ConstantViewBuilder implements ConversationViewBuilder<never, typeof EMPTY_SNAPSHOT> {
  readonly empty = EMPTY_SNAPSHOT
  replace(): typeof EMPTY_SNAPSHOT { return EMPTY_SNAPSHOT }
  apply(): typeof EMPTY_SNAPSHOT { return EMPTY_SNAPSHOT }
}

/** Register one constant view definition under the given target id. */
const constantView = (target: string): ConversationViewDefinition<never, typeof EMPTY_SNAPSHOT> => ({
  target,
  create: () => new ConstantViewBuilder(),
})

/**
 * Client plugin body: register the dictionaries, the view definitions (the
 * engine-side builders the session snapshot machinery instantiates), and the
 * two view tabs. The view-definition registrations ride a runtime inject on
 * conversationViews — provided by the runtime plugin — so this entry activates
 * regardless of runtime startup order.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'hippocampus: dictionaries')
  // Registration-time text (the tab labels) reads through the bound translate
  // as a thunk, so it follows the active locale without re-registration.
  const t = ctx.locale.bind(NS)
  ctx.inject(['conversationViews'], viewsCtx => {
    viewsCtx.effect(() => viewsCtx.conversationViews.register(constantView('hippocampus')), 'hippocampus: view definition')
    viewsCtx.effect(() => viewsCtx.conversationViews.register(constantView('hippocampus-context')), 'hippocampus: context view definition')
  })
  ctx.slots.inject(
    'conversation.view',
    () => ctx.slots.register({
      name: 'conversation.view',
      id: 'hippocampus',
      // After trajectory: memory is reference material, read after the fact.
      order: 20,
      locale: NS,
      label: () => t('view.label'),
    }, MemoryView),
  )
  ctx.slots.inject(
    'conversation.view',
    () => ctx.slots.register({
      name: 'conversation.view',
      id: 'hippocampus-context',
      // Right after the memory tab: same plugin, reference surface.
      order: 21,
      locale: NS,
      label: () => t('ctx.view.label'),
    }, ContextView),
  )
}
