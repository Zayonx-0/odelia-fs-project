package com.odelia.kanban.security;

import com.odelia.kanban.entity.Board;
import com.odelia.kanban.entity.BoardMember;
import com.odelia.kanban.repository.BoardMemberRepository;
import jakarta.ws.rs.ForbiddenException;
import org.junit.jupiter.api.Test;
import java.lang.reflect.Proxy;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;

class BoardAccessTest {
    private final Board board = new Board("Project", "alice");

    private BoardAccess access(String username, boolean admin, boolean member) {
        board.setId(1L);
        BoardAccess access = new BoardAccess();
        access.currentUser = new CurrentUser() {
            @Override public String name() { return username; }
            @Override public boolean isAdmin() { return admin; }
        };
        access.members = (BoardMemberRepository) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[]{BoardMemberRepository.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("findByBoardIdAndUsername"))
                        return member ? Optional.of(new BoardMember(1L, username)) : Optional.empty();
                    throw new UnsupportedOperationException(method.getName());
                });
        return access;
    }

    @Test void ownerAndAdminCanManageAndCollaborate() {
        for (BoardAccess access : new BoardAccess[]{access("alice", false, false), access("carol", true, false)}) {
            assertDoesNotThrow(() -> access.requireBoardAccess(board));
            assertDoesNotThrow(() -> access.requireBoardOwner(board));
        }
    }

    @Test void memberCanCollaborateButCannotManage() {
        BoardAccess access = access("bob", false, true);
        assertDoesNotThrow(() -> access.requireBoardAccess(board));
        assertThrows(ForbiddenException.class, () -> access.requireBoardOwner(board));
    }

    @Test void removedMemberAndStrangerAreDenied() {
        BoardAccess access = access("bob", false, false);
        assertThrows(ForbiddenException.class, () -> access.requireBoardAccess(board));
        assertThrows(ForbiddenException.class, () -> access.requireBoardOwner(board));
    }
}
