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
const DEFAULT_DECK = "default";

type ReviewAction = "good" | "repeat";

interface SrsData {
	interval: number;
	due: string;
	lastReviewed?: string;
	ease?: number;
	deck: string;
}

interface ReviewQueueItem {
	file: TFile;
	srs: SrsData;
}

interface DeckStats {
	total: number;
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

function normalizeDeckName(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : null;
}

function formatNoteCount(count: number, suffix = ""): string {
	return `${count} note${count === 1 ? "" : "s"}${suffix}`;
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
		summary.setText(
			`${formatNoteCount(this.plugin.totalReviewNoteCount)} in all decks | ${formatNoteCount(items.length, " due")}`,
		);

		const list = container.createDiv({ cls: "simple-srs-list" });
		if (this.plugin.deckStats.size === 0) {
			list.createDiv({
				text: "No review notes found.",
				cls: "simple-srs-summary",
			});
			return;
		}

		const itemsByDeck = new Map<string, ReviewQueueItem[]>();
		for (const item of items) {
			const deckItems = itemsByDeck.get(item.srs.deck) ?? [];
			deckItems.push(item);
			itemsByDeck.set(item.srs.deck, deckItems);
		}

		for (const [deck, stats] of this.plugin.deckStats) {
			const deckItems = itemsByDeck.get(deck) ?? [];
			const section = list.createEl("details", {
				cls: "simple-srs-deck-section",
			});
			section.open = deckItems.length > 0;
			const header = section.createEl("summary", { cls: "simple-srs-deck-header" });
			header.createDiv({ text: deck, cls: "simple-srs-deck-title" });
			header.createDiv({
				text: `${formatNoteCount(stats.total)} total | ${formatNoteCount(deckItems.length, " due")}`,
				cls: "simple-srs-deck-count",
			});

			const deckList = section.createDiv({ cls: "simple-srs-deck-list" });
			if (deckItems.length === 0) {
				deckList.createDiv({
					text: "No notes are due in this deck.",
					cls: "simple-srs-summary",
				});
				continue;
			}

			for (const item of deckItems) {
				const card = deckList.createDiv({ cls: "simple-srs-card" });
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
}

export default class SimpleSrsReviewPlugin extends Plugin {
	reviewQueue: ReviewQueueItem[] = [];
	deckStats = new Map<string, DeckStats>();
	totalReviewNoteCount = 0;

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
		const deckStats = new Map<string, DeckStats>();
		let totalReviewNoteCount = 0;

		for (const file of files) {
			if (!this.isReviewNote(file)) {
				continue;
			}

			const srs = this.getSrsData(file);
			const stats = deckStats.get(srs.deck) ?? { total: 0 };
			stats.total += 1;
			deckStats.set(srs.deck, stats);
			totalReviewNoteCount += 1;

			if (srs.due <= dueToday) {
				items.push({ file, srs });
			}
		}

		items.sort((a, b) => {
			if (a.srs.deck !== b.srs.deck) {
				return a.srs.deck.localeCompare(b.srs.deck);
			}
			if (a.srs.due !== b.srs.due) {
				return a.srs.due.localeCompare(b.srs.due);
			}
			return a.file.path.localeCompare(b.file.path);
		});

		this.deckStats = new Map(
			Array.from(deckStats.entries()).sort(([deckA], [deckB]) =>
				deckA.localeCompare(deckB),
			),
		);
		this.totalReviewNoteCount = totalReviewNoteCount;
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

	getDeckName(file: TFile): string {
		const cache = this.app.metadataCache.getFileCache(file);
		const inlineTags = cache?.tags?.map((tag) => tag.tag) ?? [];

		for (const tag of inlineTags) {
			if (!tag.startsWith("#deck/")) {
				continue;
			}

			const inlineDeck = normalizeDeckName(tag.slice("#deck/".length));
			if (inlineDeck) {
				return inlineDeck;
			}
		}

		const frontmatter = cache?.frontmatter;
		const frontmatterDeck = normalizeDeckName(frontmatter?.deck);
		if (frontmatterDeck) {
			return frontmatterDeck;
		}

		const srsDeck = normalizeDeckName(frontmatter?.[SRS_FRONTMATTER_KEY]?.deck);
		if (srsDeck) {
			return srsDeck;
		}

		return DEFAULT_DECK;
	}

	getSrsData(file: TFile): SrsData {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const raw = frontmatter?.[SRS_FRONTMATTER_KEY];
		const today = todayString();
		const deck = this.getDeckName(file);

		if (!raw || typeof raw !== "object") {
			return {
				interval: 1,
				due: today,
				lastReviewed: undefined,
				ease: 2,
				deck,
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
		const storedDeck = normalizeDeckName((raw as Record<string, unknown>).deck);

		return { interval, due, lastReviewed, ease, deck: storedDeck ?? deck };
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
			srsSection.deck = this.getDeckName(file);
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
				deck: current.deck,
				interval: 1,
				due: addDays(today, 1),
				lastReviewed: today,
				ease: 1,
			};
		}

		const nextInterval = Math.max(2, current.interval * 2);
		const nextEase = Math.min((current.ease ?? 2) + 1, 10);
		return {
			deck: current.deck,
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
