import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { Board } from '../models/board';
import { AuthService } from '../auth/auth.service';
import { BoardService } from '../services/board.service';

/**
 * Lists the boards, creates one, deletes one. Each board name links to the
 * drag-and-drop board detail view ({@code /boards/:id}).
 */
@Component({
  selector: 'app-board-list',
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './board-list.component.html',
  styleUrl: './board-list.component.css'
})
export class BoardListComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly boardService = inject(BoardService);

  readonly boards = signal<Board[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly editingBoardId = signal<number | null>(null);
  readonly renaming = signal(false);
  renameDraft = '';

  newBoardName = '';

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.boardService.getBoards().subscribe({
      next: boards => {
        this.boards.set(boards);
        this.loading.set(false);
      },
      error: err => this.fail('Could not load the boards', err)
    });
  }

  createBoard(): void {
    const name = this.newBoardName.trim();
    if (!name) {
      return;
    }
    this.error.set(null);
    this.boardService.createBoard(name).subscribe({
      next: board => {
        this.boards.update(boards => [...boards, board].sort((a, b) => a.name.localeCompare(b.name)));
        this.newBoardName = '';
      },
      error: err => this.fail(`Could not create the board "${name}"`, err)
    });
  }

  deleteBoard(board: Board): void {
    if (board.id === undefined || !this.canManage(board)) {
      return;
    }
    if (!confirm(`Delete board "${board.name}"? This cannot be undone.`)) {
      return;
    }
    this.error.set(null);
    this.boardService.deleteBoard(board.id).subscribe({
      next: () => this.boards.update(boards => boards.filter(b => b.id !== board.id)),
      error: err => this.fail(`Could not delete the board "${board.name}"`, err)
    });
  }

  canManage(board: Board): boolean {
    return this.auth.isAdmin() || board.owner === this.auth.username();
  }

  isShared(board: Board): boolean {
    return !this.auth.isAdmin() && board.owner !== this.auth.username();
  }

  startRename(board: Board): void {
    if (board.id === undefined || !this.canManage(board) || this.renaming()) return;
    this.editingBoardId.set(board.id);
    this.renameDraft = board.name;
    this.error.set(null);
  }

  cancelRename(): void {
    if (this.renaming()) return;
    this.editingBoardId.set(null);
    this.renameDraft = '';
  }

  saveRename(board: Board): void {
    const name = this.renameDraft.trim();
    if (!name || board.id === undefined || !this.canManage(board) || this.renaming()) return;
    this.error.set(null);
    this.renaming.set(true);
    this.boardService.renameBoard(board.id, name).pipe(
      finalize(() => this.renaming.set(false))
    ).subscribe({
      next: updated => {
        this.boards.update(boards => boards.map(b => b.id === board.id ? updated : b)
          .sort((a, b) => a.name.localeCompare(b.name)));
        this.editingBoardId.set(null);
        this.renameDraft = '';
      },
      error: err => this.fail('Could not rename the board. Only its owner or an administrator may do this.', err)
    });
  }

  private fail(message: string, err: unknown): void {
    console.error(message, err);
    this.error.set(message);
    this.loading.set(false);
  }
}
