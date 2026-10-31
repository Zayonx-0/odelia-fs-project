import { Component, ElementRef, OnInit, inject, signal, viewChildren } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDropList,
  CdkDropListGroup,
  moveItemInArray,
  transferArrayItem
} from '@angular/cdk/drag-drop';
import { finalize, forkJoin } from 'rxjs';

import { Board, BoardList, Card, BoardMember } from '../models/board';
import { AuthService } from '../auth/auth.service';
import { BoardService } from '../services/board.service';

/**
 * The real Kanban board for one board.
 *
 * Columns come from the backend; each column's cards are dropped into an
 * Angular CDK {@link CdkDropList}. When a card is dropped, the local arrays are
 * updated for an instant response and {@code PATCH /api/cards/{id}/move} is
 * called to persist the new column and order.
 *
 * A card also shows its description under the title, and clicking a card opens
 * an inline editor for the title and description, persisted with
 * {@code PUT /api/cards/{id}}.
 *
 * New cards are added from a collapsed "+ Add a card" button at the foot of each
 * column: clicking it opens a one-field composer (title only) that stays open so
 * several cards can be typed in a row. The description is filled in afterwards
 * through the inline card editor.
 */
@Component({
  selector: 'app-board-detail',
  imports: [FormsModule, RouterLink, CdkDropListGroup, CdkDropList, CdkDrag],
  templateUrl: './board-detail.component.html',
  styleUrl: './board-detail.component.css'
})
export class BoardDetailComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly boardService = inject(BoardService);

  readonly board = signal<Board | null>(null);
  readonly members = signal<BoardMember[]>([]);
  readonly savingMembers = signal(false);
  newMember = '';
  readonly columns = signal<BoardList[]>([]);
  /** Cards keyed by column id. The arrays are mutated in place by the CDK helpers. */
  readonly cardsByList = signal<Record<number, Card[]>>({});
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** One "add a card" draft (title + description) per column, keyed by column id. */
  readonly drafts: Record<number, { title: string; description: string }> = {};

  /** Id of the column whose "add a card" composer is open, or null when all are collapsed. */
  readonly composingColumnId = signal<number | null>(null);
  /** The composer's title input (only one is in the DOM at a time), used to keep focus on it. */
  private readonly composerInputs = viewChildren<ElementRef<HTMLInputElement>>('composerInput');

  /** Id of the card currently being edited, or null when no editor is open. */
  readonly editingCardId = signal<number | null>(null);
  /** Working copy bound to the inline editor while {@link editingCardId} is set. */
  readonly editDraft = { title: '', description: '' };

  /** True from a drag start until just after it ends, so the trailing click does not open the editor. */
  private dragging = false;

  private boardId = 0;

  ngOnInit(): void {
    this.boardId = Number(this.route.snapshot.paramMap.get('id'));
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.board.set(null);
    this.members.set([]);
    this.columns.set([]);
    this.cardsByList.set({});
    this.editingCardId.set(null);
    this.composingColumnId.set(null);
    this.boardService.getBoard(this.boardId).subscribe({
      next: board => this.board.set(board),
      error: err => this.fail('Could not load the board', err)
    });
    this.loadMembers();
    this.boardService.getLists(this.boardId).subscribe({
      next: columns => {
        this.columns.set(columns);
        this.loadCards(columns);
      },
      error: err => this.fail('Could not load the columns', err)
    });
  }

  canManageMembers(): boolean {
    const board = this.board();
    return !!board && (this.auth.isAdmin() || board.owner === this.auth.username());
  }

  private loadMembers(): void {
    this.boardService.getMembers(this.boardId).subscribe({
      next: members => this.members.set(members),
      error: err => this.fail('Could not load the members', err)
    });
  }

  addMember(): void {
    const username = this.newMember.trim();
    if (!username || !this.canManageMembers() || this.savingMembers()) return;
    this.error.set(null);
    this.savingMembers.set(true);
    this.boardService.addMember(this.boardId, username).pipe(
      finalize(() => this.savingMembers.set(false))
    ).subscribe({
      next: member => {
        this.members.update(members => [...members, member].sort((a, b) => a.username.localeCompare(b.username)));
        this.newMember = '';
      },
      error: err => this.membershipError('add', err)
    });
  }

  removeMember(member: BoardMember): void {
    if (!this.canManageMembers() || this.savingMembers()) return;
    this.error.set(null);
    this.savingMembers.set(true);
    this.boardService.removeMember(this.boardId, member.username).pipe(
      finalize(() => this.savingMembers.set(false))
    ).subscribe({
      next: () => this.members.update(members => members.filter(m => m.username !== member.username)),
      error: err => this.membershipError('remove', err)
    });
  }

  private membershipError(action: 'add' | 'remove', err: { status?: number }): void {
    const reason = err.status === 403
      ? ' Only the owner or an administrator can manage members.'
      : err.status === 400
        ? ' Check that the username is not already a member or the owner.'
        : err.status === 404 ? ' The board or member no longer exists.' : ' Please try again.';
    this.fail(`Could not ${action} the member.${reason}`, err);
  }

  cardsFor(listId: number): Card[] {
    return this.cardsByList()[listId] ?? [];
  }

  /** The "add a card" draft for a column, created on first access. */
  draftFor(columnId: number): { title: string; description: string } {
    return (this.drafts[columnId] ??= { title: '', description: '' });
  }

  /** Opens the "add a card" composer for a column and focuses its title input. */
  startComposing(columnId: number): void {
    this.editingCardId.set(null);
    this.composingColumnId.set(columnId);
    this.focusComposer();
  }

  cancelComposing(): void {
    this.composingColumnId.set(null);
  }

  /** Moves focus to the composer's title input after the view has rendered it. */
  private focusComposer(): void {
    setTimeout(() => this.composerInputs()[0]?.nativeElement.focus());
  }

  addCard(column: BoardList): void {
    if (column.id === undefined) {
      return;
    }
    const draft = this.draftFor(column.id);
    const title = draft.title.trim();
    if (!title) {
      return;
    }
    const description = draft.description.trim();
    this.error.set(null);
    this.boardService.createCard(column.id, title, description || undefined).subscribe({
      next: card => {
        this.mutate(column.id!, cards => cards.push(card));
        draft.title = '';
        draft.description = '';
        // Keep the composer open so several cards can be added in a row.
        this.focusComposer();
      },
      error: err => this.fail(`Could not add "${title}"`, err)
    });
  }

  deleteCard(card: Card): void {
    if (card.id === undefined) {
      return;
    }
    if (!confirm(`Delete "${card.title}"?`)) {
      return;
    }
    this.error.set(null);
    this.boardService.deleteCard(card.id).subscribe({
      next: () => this.mutate(card.listId, cards => {
        const i = cards.findIndex(c => c.id === card.id);
        if (i > -1) {
          cards.splice(i, 1);
        }
      }),
      error: err => this.fail(`Could not delete "${card.title}"`, err)
    });
  }

  /** Opens the inline editor for a card, unless the click is the tail of a drag. */
  startEdit(card: Card): void {
    if (this.dragging || card.id === undefined) {
      return;
    }
    this.editingCardId.set(card.id);
    this.editDraft.title = card.title;
    this.editDraft.description = card.description ?? '';
  }

  cancelEdit(): void {
    this.editingCardId.set(null);
  }

  /** Persists the edited title/description with {@code PUT /api/cards/{id}}. */
  saveEdit(card: Card): void {
    const title = this.editDraft.title.trim();
    if (!title || card.id === undefined) {
      return;
    }
    const description = this.editDraft.description.trim();
    this.error.set(null);
    this.boardService.updateCard(card.id, { title, description: description || undefined }).subscribe({
      next: updated => {
        this.mutate(card.listId, cards => {
          const i = cards.findIndex(c => c.id === card.id);
          if (i > -1) {
            cards[i] = updated;
          }
        });
        this.editingCardId.set(null);
      },
      error: err => this.fail(`Could not save "${title}"`, err)
    });
  }

  onDragStarted(): void {
    this.dragging = true;
  }

  onDragEnded(): void {
    // The synthetic click fires right after mouseup; clear the flag on the next
    // tick so startEdit() sees it and ignores that one click.
    setTimeout(() => (this.dragging = false));
  }

  drop(event: CdkDragDrop<BoardList>): void {
    const card = event.item.data as Card;
    const sourceId = event.previousContainer.data.id!;
    const targetId = event.container.data.id!;

    if (event.previousContainer === event.container) {
      moveItemInArray(this.cardsFor(targetId), event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        this.cardsFor(sourceId),
        this.cardsFor(targetId),
        event.previousIndex,
        event.currentIndex
      );
      card.listId = targetId;
    }
    this.refresh();

    if (card.id === undefined) {
      return;
    }
    this.boardService.moveCard(card.id, targetId, event.currentIndex).subscribe({
      error: err => {
        this.fail('Could not move the card', err);
        this.reload();
      }
    });
  }

  private loadCards(columns: BoardList[]): void {
    const withId = columns.filter((c): c is BoardList & { id: number } => c.id !== undefined);
    if (withId.length === 0) {
      this.cardsByList.set({});
      this.loading.set(false);
      return;
    }
    forkJoin(withId.map(c => this.boardService.getCards(c.id))).subscribe({
      next: results => {
        const byList: Record<number, Card[]> = {};
        withId.forEach((c, i) => (byList[c.id] = results[i]));
        this.cardsByList.set(byList);
        this.loading.set(false);
      },
      error: err => this.fail('Could not load the cards', err)
    });
  }

  private mutate(listId: number, change: (cards: Card[]) => void): void {
    const cards = this.cardsByList()[listId] ?? [];
    change(cards);
    this.cardsByList.set({ ...this.cardsByList(), [listId]: cards });
  }

  /** Re-emit the record so the template re-renders after an in-place mutation. */
  private refresh(): void {
    this.cardsByList.set({ ...this.cardsByList() });
  }

  private fail(message: string, err: unknown): void {
    console.error(message, err);
    this.error.set(message);
    this.loading.set(false);
  }
}
