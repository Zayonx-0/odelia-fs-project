package com.odelia.kanban.security;

import com.odelia.kanban.entity.Board;
import com.odelia.kanban.entity.BoardList;
import com.odelia.kanban.entity.Card;
import com.odelia.kanban.repository.BoardListRepository;
import com.odelia.kanban.repository.BoardRepository;
import com.odelia.kanban.repository.BoardMemberRepository;
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.ForbiddenException;

/** Centralizes collaborator and owner-only authorization for boards and their contents. */
@RequestScoped
public class BoardAccess {

    @Inject
    CurrentUser currentUser;

    @Inject
    BoardRepository boards;

    @Inject
    BoardListRepository lists;

    @Inject
    BoardMemberRepository members;

    /** Allows owners, members and administrators to work on board contents. */
    public void requireBoardAccess(Board board) {
        if (!currentUser.isAdmin() && !currentUser.name().equals(board.getOwner())
                && members.findByBoardIdAndUsername(board.getId(), currentUser.name()).isEmpty()) {
            throw new ForbiddenException("Board " + board.getId() + " belongs to someone else");
        }
    }

    /** Board settings and membership are reserved for the owner and admins. */
    public void requireBoardOwner(Board board) {
        if (!currentUser.isAdmin() && !currentUser.name().equals(board.getOwner())) {
            throw new ForbiddenException("Only the owner may manage this board");
        }
    }

    /** The same check, reached through the column's board. */
    public void requireColumnAccess(BoardList column) {
        requireBoardAccess(boardOf(column));
    }

    /** The same check, reached through the card's column and then its board. */
    public void requireCardAccess(Card card) {
        requireColumnAccess(columnOf(card));
    }

    private Board boardOf(BoardList column) {
        return boards.findById(column.getBoardId())
                     .orElseThrow(() -> orphan("column " + column.getId()));
    }

    private BoardList columnOf(Card card) {
        return lists.findById(card.getListId())
                    .orElseThrow(() -> orphan("card " + card.getId()));
    }

    /** With no board to check against, nobody can be shown to own the row: deny. */
    private ForbiddenException orphan(String what) {
        return new ForbiddenException("Cannot establish who owns " + what);
    }
}
