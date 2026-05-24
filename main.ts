import {
	App,
	ItemView,
	Menu,
	Notice,
	Plugin,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

const VIEW_TYPE_SRS_QUEUE = "simple-srs-review-queue";
const REVIEW_TAG = "#review";
const SRS_FRONTMATTER_KEY = "srs";

type ReviewAction = "good" | "repeat";

interface SrsData {
	interval: number;
	due: string;
	lastReviewed?: string;
	ease?: number;
}

interface ReviewQueueItem {
	file: TFile;
	srs: SrsData;
}

function todayString(): string {
	return formatLocalDate(new Date());
}

function formatLocalDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function addDays(dateString: string, days: number): string {
	const [year, month, day] = dateString.split("-").map((part) => Number(part));
	const date = new Date(year, month - 1, day);
	date.setDate(date.getDate() + days);
	return formatLocalDate(date);
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}

	const rounded = Math.round(value);
	return rounded > 0 ? rounded : fallback;
}

class ReviewQueueView extends ItemView {
	plugin: SimpleSrsReviewPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: SimpleSrsReviewPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_SRS_QUEUE;
	}

	getDisplayText(): string {
		return "Review Queue";
	}

	getIcon(): string {
		return "brain";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async render(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("simple-srs-view");

		const toolbar = container.createDiv({ cls: "simple-srs-toolbar" });
		const refreshButton = toolbar.createEl("button", { text: "Refresh queue" });
		refreshButton.addEventListener("click", async () => {
			await this.plugin.refreshQueue();
			await this.render();
		});

		const summary = container.createDiv({ cls: "simple-srs-summary" });
		const items = this.plugin.reviewQueue;
		summary.setText(`${items.length} note${items.length === 1 ? "" : "s"} due`);

		const list = container.createDiv({ cls: "simple-srs-list" });
		if (items.length === 0) {
			list.createDiv({
				text: "No review notes are due right now.",
				cls: "simple-srs-summary",
			});
			return;
		}

		for (const item of items) {
			const card = list.createDiv({ cls: "simple-srs-card" });
			card.createDiv({ text: item.file.basename, cls: "simple-srs-card-title" });
			card.createDiv({
				text: `${item.file.path} | due ${item.srs.due} | interval ${item.srs.interval}d`,
				cls: "simple-srs-card-meta",
			});

			const actions = card.createDiv({ cls: "simple-srs-actions" });

			const openButton = actions.createEl("button", { text: "Open" });
			openButton.addEventListener("click", async () => {
				await this.plugin.app.workspace.getLeaf(true).openFile(item.file);
			});

			const goodButton = actions.createEl("button", { text: "Good" });
			goodButton.addEventListener("click", async () => {
				await this.plugin.applyReviewAction(item.file, "good");
				await this.render();
			});

			const repeatButton = actions.createEl("button", { text: "Repeat" });
			repeatButton.addEventListener("click", async () => {
				await this.plugin.applyReviewAction(item.file, "repeat");
				await this.render();
			});
		}
	}
}

export default class SimpleSrsReviewPlugin extends Plugin {
	reviewQueue: ReviewQueueItem[] = [];

	async onload(): Promise<void> {
		this.registerView(
			VIEW_TYPE_SRS_QUEUE,
			(leaf) => new ReviewQueueView(leaf, this),
		);

		this.addCommand({
			id: "open-review-queue",
			name: "Open review queue",
			callback: async () => {
				await this.openQueueView();
			},
		});

		this.addRibbonIcon("brain", "Open review queue", async () => {
			await this.openQueueView();
		});

		this.addCommand({
			id: "refresh-review-queue",
			name: "Refresh review queue",
			callback: async () => {
				await this.refreshQueue();
				new Notice("Review queue refreshed");
			},
		});

		this.addCommand({
			id: "mark-active-note-good",
			name: "Mark active note as Good",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice("No active note");
					return;
				}
				await this.applyReviewAction(file, "good");
			},
		});

		this.addCommand({
			id: "mark-active-note-repeat",
			name: "Mark active note as Repeat",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice("No active note");
					return;
				}
				await this.applyReviewAction(file, "repeat");
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") {
					return;
				}

				this.addReviewMenuItems(menu, file);
			}),
		);

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					return;
				}

				this.addReviewMenuItems(menu, file);
			}),
		);

		this.registerEvent(
			this.app.metadataCache.on("changed", async (file) => {
				if (file.extension === "md") {
					await this.refreshQueue();
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.refreshQueue();
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", async () => {
				await this.refreshQueue();
			}),
		);

		await this.refreshQueue();
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_SRS_QUEUE);
	}

	addReviewMenuItems(menu: Menu, file: TFile): void {
		if (!this.isReviewNote(file)) {
			return;
		}

		menu.addItem((item) =>
			item
				.setTitle("SRS: Good")
				.setIcon("check")
				.onClick(async () => {
					await this.applyReviewAction(file, "good");
				}),
		);

		menu.addItem((item) =>
			item
				.setTitle("SRS: Repeat tomorrow")
				.setIcon("rotate-ccw")
				.onClick(async () => {
					await this.applyReviewAction(file, "repeat");
				}),
		);
	}

	async openQueueView(): Promise<void> {
		const workspaceAny = this.app.workspace as App["workspace"] & {
			getLeaf?: (type?: boolean | string) => WorkspaceLeaf;
		};

		let leaf: WorkspaceLeaf | null = null;
		if (typeof workspaceAny.getLeaf === "function") {
			try {
				leaf = workspaceAny.getLeaf("window");
			} catch {
				leaf = null;
			}
		}

		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false);
		}

		await leaf.setViewState({
			type: VIEW_TYPE_SRS_QUEUE,
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	async refreshQueue(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		const dueToday = todayString();
		const items: ReviewQueueItem[] = [];

		for (const file of files) {
			if (!this.isReviewNote(file)) {
				continue;
			}

			const srs = this.getSrsData(file);
			if (srs.due <= dueToday) {
				items.push({ file, srs });
			}
		}

		items.sort((a, b) => {
			if (a.srs.due !== b.srs.due) {
				return a.srs.due.localeCompare(b.srs.due);
			}
			return a.file.path.localeCompare(b.file.path);
		});

		this.reviewQueue = items;
		await this.rerenderQueueView();
	}

	isReviewNote(file: TFile): boolean {
		const cache = this.app.metadataCache.getFileCache(file);
		const inlineTags = cache?.tags?.map((tag) => tag.tag) ?? [];
		if (inlineTags.includes(REVIEW_TAG)) {
			return true;
		}

		const frontmatterTags = cache?.frontmatter?.tags;
		if (typeof frontmatterTags === "string") {
			const tags = frontmatterTags.split(/[\s,]+/);
			return tags.includes("review") || tags.includes(REVIEW_TAG);
		}

		if (Array.isArray(frontmatterTags)) {
			return frontmatterTags.some((tag) => tag === "review" || tag === REVIEW_TAG);
		}

		return false;
	}

	getSrsData(file: TFile): SrsData {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const raw = frontmatter?.[SRS_FRONTMATTER_KEY];
		const today = todayString();

		if (!raw || typeof raw !== "object") {
			return {
				interval: 1,
				due: today,
				lastReviewed: undefined,
				ease: 2,
			};
		}

		const interval = normalizePositiveInteger((raw as Record<string, unknown>).interval, 1);
		const due = typeof (raw as Record<string, unknown>).due === "string"
			? String((raw as Record<string, unknown>).due)
			: today;
		const lastReviewed = typeof (raw as Record<string, unknown>).lastReviewed === "string"
			? String((raw as Record<string, unknown>).lastReviewed)
			: undefined;
		const ease = normalizePositiveInteger((raw as Record<string, unknown>).ease, 2);

		return { interval, due, lastReviewed, ease };
	}

	async applyReviewAction(file: TFile, action: ReviewAction): Promise<void> {
		if (!this.isReviewNote(file)) {
			new Notice("This note does not contain #review");
			return;
		}

		const current = this.getSrsData(file);
		const today = todayString();
		const next = this.getNextSrsData(current, action, today);

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const srsSection = typeof frontmatter[SRS_FRONTMATTER_KEY] === "object" &&
				frontmatter[SRS_FRONTMATTER_KEY] !== null
				? frontmatter[SRS_FRONTMATTER_KEY] as Record<string, unknown>
				: {};

			srsSection.interval = next.interval;
			srsSection.due = next.due;
			srsSection.lastReviewed = next.lastReviewed;
			srsSection.ease = next.ease;
			frontmatter[SRS_FRONTMATTER_KEY] = srsSection;
		});

		await this.refreshQueue();
		new Notice(
			action === "good"
				? `Next review for ${file.basename}: ${next.due}`
				: `${file.basename} scheduled for ${next.due}`,
		);
	}

	getNextSrsData(current: SrsData, action: ReviewAction, today: string): SrsData {
		if (action === "repeat") {
			return {
				interval: 1,
				due: addDays(today, 1),
				lastReviewed: today,
				ease: 1,
			};
		}

		const nextInterval = Math.max(2, current.interval * 2);
		const nextEase = Math.min((current.ease ?? 2) + 1, 10);
		return {
			interval: nextInterval,
			due: addDays(today, nextInterval),
			lastReviewed: today,
			ease: nextEase,
		};
	}

	async rerenderQueueView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SRS_QUEUE);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof ReviewQueueView) {
				await view.render();
			}
		}
	}
}
