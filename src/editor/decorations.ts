import { RangeSetBuilder, StateField, type EditorState, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { filePathFromState } from "./cm";
import { annotationHostFacet } from "../host";
import { annotationRange, appliedRange, visibleAppliedRange } from "../locate";
import type { PosMap } from "../offsets";
import {
	editorUiField,
	refreshDecorationsEffect,
	setDraftEffect,
	setEditingEffect,
	setFlashEffect,
} from "./state";
import { cardWidgetAnchor } from "./table-anchor";
import { CardStackWidget, type CardItem } from "./widgets";

interface PendingDeco {
	from: number;
	to: number;
	deco: Decoration;
}

function hasRebuildEffect(tr: Transaction): boolean {
	return tr.effects.some(
		(effect) =>
			effect.is(setDraftEffect) ||
			effect.is(setEditingEffect) ||
			effect.is(setFlashEffect) ||
			effect.is(refreshDecorationsEffect),
	);
}

function buildDecorations(state: EditorState, changes?: PosMap | null, before?: string): DecorationSet {
	const host = state.facet(annotationHostFacet);
	const ui = state.field(editorUiField, false);
	if (!host || !ui) return Decoration.none;

	const review = host.isReviewMode();
	const filePath = filePathFromState(state);
	const doc = state.doc.toString();
	const pending: PendingDeco[] = [];
	const stacks = new Map<number, { items: CardItem[]; draft: typeof ui.draft }>();

	if (filePath) {
		for (const change of host.appliedForFile(filePath)) {
			const located = appliedRange(doc, change, changes, before);
			if (!located) continue;
			const range = visibleAppliedRange(doc, located);
			if (range.from === range.to) continue;
			const classes = ["aa-applied"];
			if (ui.flashId === change.id) classes.push("aa-applied-flash");
			pending.push({
				from: range.from,
				to: range.to,
				deco: Decoration.mark({ class: classes.join(" ") }),
			});
		}
	}

	if (!review && !ui.draft) return finishDecorations(pending);

	if (review && filePath) {
		host.store.forFile(filePath).forEach((annotation, index) => {
			const range = annotationRange(doc, annotation, changes, before);
			if (!range || range.to <= range.from) return;
			const classes = ["aa-highlight"];
			if (ui.flashId === annotation.id) classes.push("aa-highlight-flash");
			pending.push({
				from: range.from,
				to: range.to,
				deco: Decoration.mark({ class: classes.join(" ") }),
			});
			const lineEnd = state.doc.lineAt(range.to).to;
			const stack = stacks.get(lineEnd) ?? { items: [], draft: null };
			stack.items.push({
				annotation,
				index: index + 1,
				editing: ui.editingId === annotation.id,
			});
			stacks.set(lineEnd, stack);
		});
	}

	const draft = validDraftRange(state, ui.draft);
	if (draft) {
		pending.push({
			from: draft.from,
			to: draft.to,
			deco: Decoration.mark({ class: "aa-highlight aa-highlight-draft" }),
		});
		const lineEnd = state.doc.lineAt(draft.to).to;
		const stack = stacks.get(lineEnd) ?? { items: [], draft: null };
		stack.draft = draft;
		stacks.set(lineEnd, stack);
	}

	const anchored = new Map<number, { items: CardItem[]; draft: typeof ui.draft; inlineOrder: boolean }>();
	for (const [pos, stack] of stacks) {
		const anchor = cardWidgetAnchor(state.doc, pos);
		const found = anchored.get(anchor.pos);
		if (!found) {
			anchored.set(anchor.pos, {
				items: [...stack.items],
				draft: stack.draft,
				inlineOrder: anchor.inlineOrder,
			});
			continue;
		}
		found.items.push(...stack.items);
		if (stack.draft) found.draft = stack.draft;
	}

	for (const [pos, stack] of anchored) {
		pending.push({
			from: pos,
			to: pos,
			deco: Decoration.widget({
				widget: new CardStackWidget(stack.items, stack.draft, host),
				block: true,
				side: 1,
				...(stack.inlineOrder ? { inlineOrder: true } : {}),
			}),
		});
	}

	return finishDecorations(pending);
}

function finishDecorations(pending: PendingDeco[]): DecorationSet {
	pending.sort((a, b) => a.from - b.from || a.to - b.to);
	const builder = new RangeSetBuilder<Decoration>();
	for (const item of pending) builder.add(item.from, item.to, item.deco);
	return builder.finish();
}

export const annotationsDecoField = StateField.define<DecorationSet>({
	create: (state) => buildDecorations(state),
	update(deco, tr) {
		if (
			tr.docChanged ||
			filePathFromState(tr.startState) !== filePathFromState(tr.state) ||
			hasRebuildEffect(tr)
		) {
			return buildDecorations(
				tr.state,
				tr.docChanged ? tr.changes : null,
				tr.docChanged ? tr.startState.doc.toString() : undefined,
			);
		}
		return deco;
	},
	provide: (field) => EditorView.decorations.from(field),
});

function validDraftRange<T extends { from: number; to: number }>(
	state: EditorState,
	draft: T | null,
): T | null {
	if (!draft) return null;
	if (draft.from >= draft.to) return null;
	if (draft.from < 0 || draft.to > state.doc.length) return null;
	return draft;
}
