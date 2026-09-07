import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { annotationHostFacet } from "../host";
import { annotationAtRange } from "../locate";
import { editorUiField } from "./state";
import { filePathFromState } from "./cm";

class SelectionToolbarPlugin {
	private button: HTMLButtonElement | null = null;
	private readonly onScroll: () => void;
	private raf: number | null = null;
	private destroyed = false;

	constructor(private readonly view: EditorView) {
		this.onScroll = () => this.measureAndPlace();
		view.scrollDOM.addEventListener("scroll", this.onScroll);
		this.scheduleMeasure();
	}

	update(update: ViewUpdate): void {
		if (
			!(
				update.selectionSet ||
				update.focusChanged ||
				update.viewportChanged ||
				update.docChanged ||
				update.geometryChanged ||
				update.transactions.some((tr) => tr.effects.length > 0)
			)
		) {
			return;
		}

		if (!this.computeShouldShow()) {
			this.cancelRaf();
			this.clearButton();
			return;
		}

		this.scheduleMeasure();
	}

	destroy(): void {
		this.destroyed = true;
		this.cancelRaf();
		this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
		this.clearButton();
	}

	private computeShouldShow(): boolean {
		const host = this.view.state.facet(annotationHostFacet);
		const ui = this.view.state.field(editorUiField);
		const selection = this.view.state.selection.main;
		if (!host || !this.view.hasFocus || selection.empty || ui.draft || ui.editingId) return false;
		const file = filePathFromState(this.view.state);
		if (!file) return false;
		return !annotationAtRange(
			this.view.state.doc.toString(),
			host.store.forFile(file),
			selection.from,
			selection.to,
		);
	}

	private scheduleMeasure(): void {
		if (this.raf !== null) return;
		this.raf = window.requestAnimationFrame(() => {
			this.raf = null;
			if (this.destroyed) return;
			this.measureAndPlace();
		});
	}

	private cancelRaf(): void {
		if (this.raf === null) return;
		window.cancelAnimationFrame(this.raf);
		this.raf = null;
	}

	private measureAndPlace(): void {
		if (this.destroyed) return;
		if (!this.computeShouldShow()) {
			this.clearButton();
			return;
		}

		const host = this.view.state.facet(annotationHostFacet);
		if (!host) {
			this.clearButton();
			return;
		}

		const selection = this.view.state.selection.main;
		const coords = this.view.coordsAtPos(selection.to);
		if (!coords) {
			this.clearButton();
			return;
		}

		if (!this.button) {
			this.button = document.createElement("button");
			this.button.type = "button";
			this.button.className = "aa-selection-btn";
			this.button.textContent = "+ Annotation";
			this.button.addEventListener("mousedown", (event) => {
				event.preventDefault();
				event.stopPropagation();
			});
			this.button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				const current = this.view.state.facet(annotationHostFacet);
				current?.beginDraft(this.view);
			});
			this.view.dom.ownerDocument.body.appendChild(this.button);
		}

		this.button.style.left = `${coords.left}px`;
		this.button.style.top = `${coords.bottom + 8}px`;
	}

	private clearButton(): void {
		this.button?.remove();
		this.button = null;
	}
}

export const selectionToolbarPlugin = ViewPlugin.fromClass(SelectionToolbarPlugin);
