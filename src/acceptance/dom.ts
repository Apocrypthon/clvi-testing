/**
 * A 30-line element builder, in place of a framework.
 *
 * Item 1 of the checklist this page carries gives the whole cold load 3 s on a
 * phone. Shipping a runtime to render seven list items would spend that budget
 * on nothing. Everything user-typed goes in through `text`, which is
 * `textContent` — there is no innerHTML path in this page at all, so a note
 * containing markup stays a note.
 */

export type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  /** data-* attributes. */
  data?: Record<string, string>;
  /** Everything else is set as an attribute; `false`/`undefined` is omitted. */
  [attr: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false || value === null) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key === "data") {
      for (const [name, item] of Object.entries(value as Record<string, string>)) {
        node.dataset[name] = item;
      }
    } else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function on<E extends keyof HTMLElementEventMap>(
  node: HTMLElement,
  event: E,
  handler: (event: HTMLElementEventMap[E]) => void,
): void {
  node.addEventListener(event, handler);
}

export function clear(node: Element): void {
  node.replaceChildren();
}

export function must<T extends Element>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in the page`);
  return node as unknown as T;
}
