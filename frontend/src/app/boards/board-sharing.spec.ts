import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { BoardDetailComponent } from './board-detail.component';
import { BoardListComponent } from './board-list.component';

describe('Board sharing acceptance criteria', () => {
  let http: HttpTestingController;
  const username = signal<string | null>('alice');
  const isAdmin = signal(false);
  beforeEach(async () => {
    username.set('alice'); isAdmin.set(false);
    await TestBed.configureTestingModule({
      imports: [BoardDetailComponent, BoardListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: AuthService, useValue: { username, isAdmin } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', '7']]) } } }]
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    spyOn(console, 'error');
  });
  afterEach(() => http.verify());
  function detail() {
    const fixture = TestBed.createComponent(BoardDetailComponent);
    fixture.detectChanges();
    http.expectOne('/api/boards/7').flush({ id: 7, name: 'Shared sprint', owner: 'alice' });
    http.expectOne('/api/boards/7/members').flush([{ id: 1, boardId: 7, username: 'bob' }]);
    http.expectOne('/api/boards/7/lists').flush([]);
    fixture.detectChanges();
    return fixture;
  }
  for (const role of ['owner', 'member', 'admin']) {
    it(`shows members and appropriate membership controls to ${role}`, () => {
      username.set(role === 'owner' ? 'alice' : role === 'member' ? 'bob' : 'carol');
      isAdmin.set(role === 'admin');
      const f = detail();
      const panel: HTMLElement = f.nativeElement.querySelector('[aria-label="Board members"]');
      expect(panel.textContent).toContain('bob');
      expect(!!panel.querySelector('input')).toBe(role !== 'member');
      expect(!!panel.querySelector('[aria-label="Remove bob"]')).toBe(role !== 'member');
    });
    it(`shows shared boards and appropriate delete controls to ${role}`, () => {
      username.set(role === 'owner' ? 'alice' : role === 'member' ? 'bob' : 'carol');
      isAdmin.set(role === 'admin');
      const f = TestBed.createComponent(BoardListComponent);
      f.detectChanges();
      http.expectOne('/api/boards').flush([{ id: 7, name: 'Shared sprint', owner: 'alice' }]);
      f.detectChanges();
      expect(f.nativeElement.textContent).toContain('Shared sprint');
      expect(!!f.nativeElement.querySelector('button.danger')).toBe(role !== 'member');
    });
  }
  it('adds a member and updates the rendered membership list', () => {
    const f = detail();
    f.componentInstance.newMember = ' dave ';
    f.componentInstance.addMember();
    const req = http.expectOne('/api/boards/7/members');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'dave' });
    req.flush({ id: 2, boardId: 7, username: 'dave' });
    f.detectChanges();
    expect(f.nativeElement.querySelector('[aria-label="Board members"]').textContent).toContain('dave');
    expect(f.componentInstance.newMember).toBe('');
  });
  it('removes a member and updates the rendered membership list', () => {
    const f = detail();
    f.nativeElement.querySelector('[aria-label="Remove bob"]').click();
    const req = http.expectOne('/api/boards/7/members/bob');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    f.detectChanges();
    expect(f.nativeElement.querySelector('[aria-label="Board members"]').textContent).not.toContain('bob');
  });
  it('renders an explanatory error after a rejected duplicate addition', () => {
    const f = detail();
    f.componentInstance.newMember = 'bob';
    f.componentInstance.addMember();
    http.expectOne('/api/boards/7/members').flush({}, { status: 400, statusText: 'Bad Request' });
    f.detectChanges();
    expect(f.nativeElement.querySelector('.error').textContent).toContain('already a member or the owner');
    expect(f.componentInstance.members().length).toBe(1);
  });
  it('renders an error and preserves membership after a forbidden removal', () => {
    const f = detail();
    f.componentInstance.removeMember({ boardId: 7, username: 'bob' });
    http.expectOne('/api/boards/7/members/bob').flush({}, { status: 403, statusText: 'Forbidden' });
    f.detectChanges();
    expect(f.nativeElement.querySelector('.error').textContent).toContain('Could not remove');
    expect(f.componentInstance.members().length).toBe(1);
  });

  it('blocks duplicate submissions until the server responds and enables retry after an error', () => {
    const f = detail();
    const component = f.componentInstance;
    component.newMember = 'dave';
    component.addMember();
    component.addMember();
    component.removeMember({ boardId: 7, username: 'bob' });
    f.detectChanges();
    expect(component.savingMembers()).toBeTrue();
    expect(f.nativeElement.querySelector('button[type="submit"]').disabled).toBeTrue();
    http.expectOne('/api/boards/7/members').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(component.savingMembers()).toBeFalse();
    expect(component.newMember).toBe('dave');
    component.addMember();
    http.expectOne('/api/boards/7/members').flush({ boardId: 7, username: 'dave' });
    expect(component.savingMembers()).toBeFalse();
  });

  it('does not optimistically remove a member while the request is pending', () => {
    const f = detail();
    f.componentInstance.removeMember({ boardId: 7, username: 'bob' });
    expect(f.componentInstance.members().map(m => m.username)).toEqual(['bob']);
    http.expectOne('/api/boards/7/members/bob').flush(null);
    expect(f.componentInstance.members()).toEqual([]);
  });

  it('sends no membership request from a member even if its methods are called directly', () => {
    username.set('bob');
    const f = detail();
    f.componentInstance.newMember = 'dave';
    f.componentInstance.addMember();
    f.componentInstance.removeMember({ boardId: 7, username: 'bob' });
    http.expectNone('/api/boards/7/members');
    http.expectNone('/api/boards/7/members/bob');
    expect(f.componentInstance.members().map(m => m.username)).toEqual(['bob']);
  });

  it('does not submit an empty username', () => {
    const f = detail();
    f.componentInstance.newMember = '   ';
    f.componentInstance.addMember();
    http.expectNone('/api/boards/7/members');
    expect(f.componentInstance.savingMembers()).toBeFalse();
  });

  it('clears previously visible content when access is revoked on reload', () => {
    const f = detail();
    f.componentInstance.reload();
    for (const path of ['/api/boards/7', '/api/boards/7/members', '/api/boards/7/lists']) {
      http.expectOne(path).flush({}, { status: 403, statusText: 'Forbidden' });
    }
    f.detectChanges();
    expect(f.componentInstance.board()).toBeNull();
    expect(f.componentInstance.members()).toEqual([]);
    expect(f.nativeElement.querySelector('[aria-label="Board members"]')).toBeNull();
    expect(f.nativeElement.querySelector('.error').textContent).toContain('Could not load');
  });

  function boardList() {
    const f = TestBed.createComponent(BoardListComponent);
    f.detectChanges();
    http.expectOne('/api/boards').flush([
      { id: 7, name: 'Shared sprint', owner: 'alice' },
      { id: 8, name: 'Personal', owner: 'bob' }
    ]);
    f.detectChanges();
    return f;
  }

  it('marks a shared board but not a personal board', () => {
    username.set('bob');
    const f = boardList();
    const rows = f.nativeElement.querySelectorAll('li.board');
    expect(rows[0].querySelector('.shared-badge')).not.toBeNull();
    expect(rows[1].querySelector('.shared-badge')).toBeNull();
  });

  it('does not label boards merely visible to an administrator as shared', () => {
    username.set('carol'); isAdmin.set(true);
    const f = boardList();
    expect(f.nativeElement.querySelector('.shared-badge')).toBeNull();
  });

  it('refuses direct rename and delete calls from a non-owner member', () => {
    username.set('bob');
    const f = boardList();
    const shared = f.componentInstance.boards()[0];
    f.componentInstance.startRename(shared);
    f.componentInstance.renameDraft = 'Forbidden';
    f.componentInstance.saveRename(shared);
    f.componentInstance.deleteBoard(shared);
    expect(f.componentInstance.editingBoardId()).toBeNull();
    http.expectNone('/api/boards/7');
  });

  it('renames an owned board, blocks duplicate saves and sorts the result', () => {
    const f = boardList();
    const board = f.componentInstance.boards()[0];
    f.componentInstance.startRename(board);
    f.componentInstance.renameDraft = ' A renamed board ';
    f.componentInstance.saveRename(board);
    f.componentInstance.saveRename(board);
    const request = http.expectOne('/api/boards/7');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ name: 'A renamed board' });
    request.flush({ ...board, name: 'A renamed board' });
    f.detectChanges();
    expect(f.componentInstance.renaming()).toBeFalse();
    expect(f.componentInstance.editingBoardId()).toBeNull();
    expect(f.componentInstance.boards()[0].name).toBe('A renamed board');
  });

  it('keeps the rename draft after an error and permits a retry', () => {
    const f = boardList();
    const board = f.componentInstance.boards()[0];
    f.componentInstance.startRename(board);
    f.componentInstance.renameDraft = 'New name';
    f.componentInstance.saveRename(board);
    http.expectOne('/api/boards/7').flush({}, { status: 403, statusText: 'Forbidden' });
    expect(f.componentInstance.renaming()).toBeFalse();
    expect(f.componentInstance.editingBoardId()).toBe(7);
    expect(f.componentInstance.renameDraft).toBe('New name');
    expect(f.componentInstance.boards()[0].name).toBe('Shared sprint');
    f.componentInstance.saveRename(board);
    http.expectOne('/api/boards/7').flush({ ...board, name: 'New name' });
  });

  it('cancels a rename or ignores a blank name without sending a request', () => {
    const f = boardList();
    const board = f.componentInstance.boards()[0];
    f.componentInstance.startRename(board);
    f.componentInstance.renameDraft = ' ';
    f.componentInstance.saveRename(board);
    f.componentInstance.cancelRename();
    expect(f.componentInstance.editingBoardId()).toBeNull();
    http.expectNone('/api/boards/7');
  });
});
