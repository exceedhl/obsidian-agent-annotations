import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { annotationHostFacet } from "../host";
import { filePathFromState } from "./cm";

function isUserEdit(update: ViewUpdate): boolean {
	return update.transactions.some(
		(tr) =>
			tr.isUserEvent("input") ||
			tr.isUserEvent("delete") ||
			tr.isUserEvent("undo") ||
			tr.isUserEvent("redo"),
	);
}

export const userBaselinePlugin = ViewPlugin.fromClass(
	class {
		update(update: ViewUpdate): void {
			if (!update.docChanged) return;
			const host = update.state.facet(annotationHostFacet);
			const path = filePathFromState(update.state);
			if (!host || !path) return;
			const before = update.startState.doc.toString();
			const after = update.state.doc.toString();
			host.trackDocumentEdit(path, update.changes, before, after, isUserEdit(update));
		}
	},
);
