import { EditorView, WidgetType } from "@codemirror/view";
import { matchesChord } from "../hotkey";
import type { AnnotationHost } from "../host";
import type { Annotation, DraftAnnotation } from "../types";

export interface CardItem {
	annotation: Annotation;
	index: number;
	editing: boolean;
}

export class CardStackWidget extends WidgetType {
	constructor(
		readonly items: CardItem[],
		readonly draft: DraftAnnotation | null,
		readonly host: AnnotationHost,
	) {
		super();
	}

	eq(other: CardStackWidget): boolean {
		return (
			this.host.saveHotkey() === other.host.saveHotkey() &&
			this.host.cancelHotkey() === other.host.cancelHotkey() &&
			draftEq(this.draft, other.draft) &&
			this.items.length === other.items.length &&
			this.items.every((item, i) => {
				const b = other.items[i]!;
				return (
					item.annotation.id === b.annotation.id &&
					item.annotation.instruction === b.annotation.instruction &&
					item.index === b.index &&
					item.editing === b.editing
				);
			})
		);
	}

	toDOM(view: EditorView): HTMLElement {
		return renderCardStack(this.items, this.draft, this.host, view);
	}

	get estimatedHeight(): number {
		const count = this.items.length + (this.draft ? 1 : 0);
		if (count === 0) return 12;
		let height = 12;
		for (const item of this.items) height += item.editing ? 120 : 52;
		if (this.draft) height += 120;
		if (count > 1) height += 4 * (count - 1);
		return height;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

export function renderCardStack(
	items: CardItem[],
	draft: DraftAnnotation | null,
	host: AnnotationHost,
	view: EditorView,
): HTMLElement {
	const widget = el("div", "aa-card-widget");
	const stack = el("div", "aa-card-stack");
	for (const item of items) {
		stack.appendChild(
			item.editing
				? renderEditor(item.annotation.instruction, {
						label: "Edit annotation",
						onSave: (text) => void host.saveEdit(view, item.annotation.id, text),
						onCancel: () => host.setEditing(view, null),
						host,
					})
				: renderSavedCard(item, host, view),
		);
	}
	if (draft) {
		stack.appendChild(
			renderEditor("", {
				label: "Annotation",
				placeholder: "Write an annotation",
				onSave: (text) => void host.saveDraft(view, text),
				onCancel: () => host.cancelDraft(view),
				host,
			}),
		);
	}
	widget.appendChild(stack);
	return widget;
}

function renderSavedCard(item: CardItem, host: AnnotationHost, view: EditorView): HTMLElement {
	const card = el("div", "aa-card");
	const body = el("div", "aa-card-body", item.annotation.instruction);
	body.addEventListener("click", () => host.setEditing(view, item.annotation.id));
	const remove = button("×", "aa-card-close");
	remove.setAttribute("aria-label", "Delete");
	remove.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		void host.deleteAnnotation(item.annotation.id);
	});
	card.appendChild(body);
	card.appendChild(remove);
	return card;
}

function renderEditor(
	initial: string,
	opts: {
		label: string;
		placeholder?: string;
		onSave: (text: string) => void;
		onCancel: () => void;
		host: AnnotationHost;
	},
): HTMLElement {
	const card = el("div", "aa-card aa-card-editing");

	const textarea = document.createElement("textarea");
	textarea.className = "aa-card-input";
	textarea.value = initial;
	textarea.rows = 2;
	textarea.placeholder = opts.placeholder ?? "";
	textarea.setAttribute("aria-label", opts.label);

	const footer = el("div", "aa-card-footer");
	const cancelBtn = button("Cancel", "aa-card-btn");
	const saveBtn = button("Save", "aa-card-btn aa-card-btn-primary");
	saveBtn.disabled = !initial.trim();

	const commit = (): void => {
		const text = textarea.value.trim();
		if (text) opts.onSave(text);
	};

	textarea.addEventListener("keydown", (event) => {
		event.stopPropagation();
		if (matchesChord(event, opts.host.cancelHotkey())) {
			event.preventDefault();
			opts.onCancel();
			return;
		}
		if (matchesChord(event, opts.host.saveHotkey())) {
			event.preventDefault();
			commit();
		}
	});
	textarea.addEventListener("input", () => {
		saveBtn.disabled = !textarea.value.trim();
	});
	textarea.addEventListener("mousedown", (event) => event.stopPropagation());

	cancelBtn.addEventListener("click", (event) => {
		event.preventDefault();
		opts.onCancel();
	});
	saveBtn.addEventListener("click", (event) => {
		event.preventDefault();
		commit();
	});

	card.appendChild(textarea);
	footer.appendChild(cancelBtn);
	footer.appendChild(saveBtn);
	card.appendChild(footer);

	window.requestAnimationFrame(() => {
		textarea.focus();
		if (initial) textarea.setSelectionRange(textarea.value.length, textarea.value.length);
	});

	return card;
}

function draftEq(a: DraftAnnotation | null, b: DraftAnnotation | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.from === b.from && a.to === b.to && a.selectedText === b.selectedText;
}

function el(tag: string, className: string, text?: string): HTMLElement {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function button(label: string, className: string): HTMLButtonElement {
	const node = document.createElement("button");
	node.type = "button";
	node.className = className;
	node.textContent = label;
	return node;
}
