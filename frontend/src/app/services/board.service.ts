import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { Board, BoardList, Card, BoardMember } from '../models/board';

/**
 * Single entry point to the Kanban REST API.
 *
 * During development `environment.apiUrl` is `/api` and requests are forwarded
 * to OpenLiberty on port 9080 by proxy.conf.json, so the browser sees a single
 * origin and no CORS pre-flight.
 */
@Injectable({ providedIn: 'root' })
export class BoardService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/boards`;
  private readonly listsUrl = `${environment.apiUrl}/lists`;
  private readonly cardsUrl = `${environment.apiUrl}/cards`;

  getBoards(): Observable<Board[]> {
    return this.http.get<Board[]>(this.baseUrl);
  }

  getBoard(id: number): Observable<Board> {
    return this.http.get<Board>(`${this.baseUrl}/${id}`);
  }

  createBoard(name: string): Observable<Board> {
    return this.http.post<Board>(this.baseUrl, { name });
  }

  renameBoard(id: number, name: string): Observable<Board> {
    return this.http.put<Board>(`${this.baseUrl}/${id}`, { name });
  }

  deleteBoard(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  getMembers(boardId: number): Observable<BoardMember[]> {
    return this.http.get<BoardMember[]>(`${this.baseUrl}/${boardId}/members`);
  }

  addMember(boardId: number, username: string): Observable<BoardMember> {
    return this.http.post<BoardMember>(`${this.baseUrl}/${boardId}/members`, { username });
  }

  removeMember(boardId: number, username: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${boardId}/members/${encodeURIComponent(username)}`);
  }

  getLists(boardId: number): Observable<BoardList[]> {
    return this.http.get<BoardList[]>(`${this.baseUrl}/${boardId}/lists`);
  }

  getCards(listId: number): Observable<Card[]> {
    return this.http.get<Card[]>(`${this.listsUrl}/${listId}/cards`);
  }

  createCard(listId: number, title: string, description?: string): Observable<Card> {
    return this.http.post<Card>(`${this.listsUrl}/${listId}/cards`, { title, description });
  }

  updateCard(id: number, patch: { title: string; description?: string }): Observable<Card> {
    return this.http.put<Card>(`${this.cardsUrl}/${id}`, patch);
  }

  deleteCard(id: number): Observable<void> {
    return this.http.delete<void>(`${this.cardsUrl}/${id}`);
  }

  /** Reorder within a column or move to another one; position is the 0-based target index. */
  moveCard(id: number, targetListId: number, position: number): Observable<Card> {
    return this.http.patch<Card>(`${this.cardsUrl}/${id}/move`, { targetListId, position });
  }
}
