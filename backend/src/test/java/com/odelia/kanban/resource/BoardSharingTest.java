package com.odelia.kanban.resource;

import com.odelia.kanban.entity.*;
import com.odelia.kanban.repository.*;
import com.odelia.kanban.security.BoardAccess;
import com.odelia.kanban.security.CurrentUser;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriBuilder;
import jakarta.ws.rs.core.UriInfo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.*;
import java.util.function.Predicate;

import static org.junit.jupiter.api.Assertions.*;

/** Resource-level tests use the real authorization code and in-memory repositories.
 * HTTP/JWT, transactions and Jakarta Data are exercised separately by scripts/test-sharing.py. */
class BoardSharingTest {
    private final Memory<Board> boardData = new Memory<>();
    private final Memory<BoardList> columnData = new Memory<>();
    private final Memory<Card> cardData = new Memory<>();
    private final Memory<BoardMember> memberData = new Memory<>();
    private final TestUser user = new TestUser();
    private BoardResource boards;
    private BoardListResource columns;
    private CardResource cards;
    private Board shared;
    private Board foreign;
    private BoardList source;
    private BoardList target;
    private BoardList privateColumn;
    private Card card;
    private Card privateCard;

    @BeforeEach void setUp() {
        BoardRepository boardRepo = boardData.repository(BoardRepository.class);
        BoardListRepository columnRepo = columnData.repository(BoardListRepository.class);
        CardRepository cardRepo = cardData.repository(CardRepository.class);
        BoardMemberRepository memberRepo = memberData.repository(BoardMemberRepository.class);
        BoardAccess access = new BoardAccess();
        inject(access, "currentUser", user);
        inject(access, "boards", boardRepo);
        inject(access, "lists", columnRepo);
        inject(access, "members", memberRepo);
        boards = new BoardResource();
        boards.currentUser = user; boards.access = access; boards.boards = boardRepo;
        boards.lists = columnRepo; boards.cards = cardRepo; boards.members = memberRepo;
        boards.uriInfo = uriInfo();
        columns = new BoardListResource();
        columns.access = access; columns.lists = columnRepo; columns.cards = cardRepo;
        columns.uriInfo = uriInfo();
        cards = new CardResource();
        cards.access = access; cards.lists = columnRepo; cards.cards = cardRepo;

        shared = boardData.add(new Board("Z shared", "alice"));
        foreign = boardData.add(new Board("Private", "alice"));
        source = columnData.add(new BoardList(shared.getId(), "Source", 0));
        target = columnData.add(new BoardList(shared.getId(), "Target", 1));
        privateColumn = columnData.add(new BoardList(foreign.getId(), "Private", 0));
        card = cardData.add(new Card(source.getId(), "Shared card", 0));
        privateCard = cardData.add(new Card(privateColumn.getId(), "Private card", 0));
        memberData.add(new BoardMember(shared.getId(), "bob"));
        user.name = "bob";
    }

    @Test void listingCombinesOwnedAndSharedBoardsWithoutLeakingPrivateBoards() {
        Board own = boardData.add(new Board("A owned", "bob"));
        assertEquals(List.of(own.getId(), shared.getId()), boards.listBoards().stream().map(Board::getId).toList());
    }

    @Test void listingDeduplicatesAndIgnoresAnOrphanedMembership() {
        // Defensive behavior even if legacy data violates the owner/member invariant.
        memberData.add(new BoardMember(shared.getId(), "alice"));
        memberData.add(new BoardMember(999L, "alice"));
        user.name = "alice";
        assertEquals(2, boards.listBoards().size());
    }

    @Test void boardCreationUsesTheCallerAndCreatesThreeColumns() {
        Board request = new Board("New", "someone-else");
        request.setId(999L);
        Board created = (Board) boards.createBoard(request).getEntity();
        assertEquals("bob", created.getOwner());
        assertNotEquals(999L, created.getId());
        assertEquals(List.of("To do", "Doing", "Done"), boards.listColumns(created.getId()).stream().map(BoardList::getName).toList());
    }

    @Test void memberCanReadTheBoardItsMembershipAndItsContents() {
        assertSame(shared, boards.getBoard(shared.getId()));
        assertEquals(List.of("bob"), boards.listMembers(shared.getId()).stream().map(BoardMember::getUsername).toList());
        assertEquals(2, boards.listColumns(shared.getId()).size());
        assertSame(source, columns.getColumn(source.getId()));
        assertEquals(List.of(card), columns.listCards(source.getId()));
        assertSame(card, cards.getCard(card.getId()));
    }

    @Test void memberCanCreateEditMoveAndDeleteContents() {
        BoardList newColumn = (BoardList) boards.addColumn(shared.getId(), new BoardList(foreign.getId(), "Extra", 2)).getEntity();
        assertEquals(shared.getId().longValue(), newColumn.getBoardId());
        columns.updateColumn(newColumn.getId(), new BoardList(999L, "Renamed column", 3));
        assertEquals("Renamed column", newColumn.getName());
        assertEquals(shared.getId().longValue(), newColumn.getBoardId());
        Card newCard = (Card) columns.addCard(newColumn.getId(), new Card(privateColumn.getId(), "New card", 99)).getEntity();
        assertEquals(newColumn.getId().longValue(), newCard.getListId());
        assertEquals(0, newCard.getPosition());
        Card edit = new Card(999L, "Edited", 99); edit.setDescription("Details");
        cards.updateCard(newCard.getId(), edit);
        assertEquals("Details", newCard.getDescription());
        assertEquals(newColumn.getId().longValue(), newCard.getListId());
        cards.move(newCard.getId(), new MoveCommand(target.getId(), 0));
        assertEquals(target.getId().longValue(), newCard.getListId());
        assertEquals(204, cards.deleteCard(newCard.getId()).getStatus());
        assertFalse(cardData.rows.containsKey(newCard.getId()));
        assertEquals(204, columns.deleteColumn(newColumn.getId()).getStatus());
        assertFalse(columnData.rows.containsKey(newColumn.getId()));
    }

    @Test void movingBetweenColumnsPersistsEvenWhenThePositionDoesNotChange() {
        cards.move(card.getId(), new MoveCommand(target.getId(), 0));
        assertEquals(target.getId().longValue(), cardData.rows.get(card.getId()).getListId());
        assertEquals(0, card.getPosition());
    }

    @Test void memberCannotMoveIntoOrOutOfAnInaccessibleBoard() {
        assertThrows(ForbiddenException.class, () -> cards.move(card.getId(), new MoveCommand(privateColumn.getId(), 0)));
        assertThrows(ForbiddenException.class, () -> cards.move(privateCard.getId(), new MoveCommand(target.getId(), 0)));
        assertEquals(source.getId().longValue(), card.getListId());
        assertEquals(privateColumn.getId().longValue(), privateCard.getListId());
    }

    @ParameterizedTest @ValueSource(strings = {"bob", "outsider"})
    void neitherMemberNorStrangerCanManageBoardOrMembership(String name) {
        user.name = name;
        List<Executable> actions = List.of(
            () -> boards.updateBoard(shared.getId(), new Board("Denied", name)),
            () -> boards.updateBoard(shared.getId(), new Board("", name)),
            () -> boards.updateBoard(shared.getId(), null),
            () -> boards.deleteBoard(shared.getId()),
            () -> boards.addMember(shared.getId(), request("carol")),
            () -> boards.addMember(shared.getId(), null),
            () -> boards.removeMember(shared.getId(), "bob"),
            () -> boards.removeMember(shared.getId(), "unknown"),
            () -> boards.removeMember(shared.getId(), "alice")
        );
        actions.forEach(action -> assertThrows(ForbiddenException.class, action));
        assertEquals("Z shared", shared.getName());
        assertEquals(1, memberData.rows.size());
    }

    @Test void unrelatedUserIsDeniedOnEveryCollaboratorResource() {
        user.name = "outsider";
        assertCollaboratorDenied();
    }

    @Test void removalRevokesEveryCollaboratorResourceWithoutChangingTheUserSession() {
        user.name = "alice";
        boards.removeMember(shared.getId(), "bob");
        user.name = "bob";
        assertCollaboratorDenied();
        assertTrue(boards.listBoards().isEmpty());
        user.name = "alice";
        boards.addMember(shared.getId(), request("bob"));
        user.name = "bob";
        assertSame(shared, boards.getBoard(shared.getId()));
    }

    @Test void membershipOfOneBoardDoesNotAuthorizeAnotherBoard() {
        assertThrows(ForbiddenException.class, () -> boards.getBoard(foreign.getId()));
        assertThrows(ForbiddenException.class, () -> columns.getColumn(privateColumn.getId()));
        assertThrows(ForbiddenException.class, () -> cards.getCard(privateCard.getId()));
    }

    @ParameterizedTest @NullAndEmptySource @ValueSource(strings = {" ", "\t", "alice"})
    void ownerCannotAddAnInvalidOrOwnerUsername(String name) {
        user.name = "alice";
        assertThrows(BadRequestException.class, () -> boards.addMember(shared.getId(), request(name)));
        assertEquals(1, memberData.rows.size());
    }

    @Test void nullRequestAndOverlongUsernameAreRejected() {
        user.name = "alice";
        assertThrows(BadRequestException.class, () -> boards.addMember(shared.getId(), null));
        assertThrows(BadRequestException.class, () -> boards.addMember(shared.getId(), request("x".repeat(121))));
    }

    @ParameterizedTest @NullAndEmptySource @ValueSource(strings = {" ", "\t"})
    void invalidRenameIsRejectedForTheOwnerWithoutChangingTheStoredName(String name) {
        user.name = "alice";
        assertThrows(BadRequestException.class, () -> boards.updateBoard(shared.getId(), new Board(name, "ignored")));
        assertEquals("Z shared", shared.getName());
    }

    @Test void membershipListIsSortedAndScopedToItsBoard() {
        user.name = "alice";
        memberData.add(new BoardMember(shared.getId(), "aaron"));
        memberData.add(new BoardMember(foreign.getId(), "private-user"));
        assertEquals(List.of("aaron", "bob"), boards.listMembers(shared.getId()).stream().map(BoardMember::getUsername).toList());
    }

    @Test void duplicatesAndOwnerRemovalAreRejectedWithoutMutatingMemberships() {
        user.name = "alice";
        assertThrows(BadRequestException.class, () -> boards.addMember(shared.getId(), request(" bob ")));
        assertThrows(BadRequestException.class, () -> boards.removeMember(shared.getId(), "alice"));
        assertEquals(List.of("bob"), boards.listMembers(shared.getId()).stream().map(BoardMember::getUsername).toList());
    }

    @Test void ownerCanAddATrimmedUsernameAndRemoveIt() {
        user.name = "alice";
        Response response = boards.addMember(shared.getId(), request(" dave "));
        assertEquals(201, response.getStatus());
        assertEquals("dave", ((BoardMember) response.getEntity()).getUsername());
        assertEquals(204, boards.removeMember(shared.getId(), "dave").getStatus());
        assertEquals(1, memberData.rows.size());
    }

    @Test void administratorCanManageAndCollaborateWithoutMembership() {
        user.name = "carol"; user.admin = true;
        assertEquals(2, boards.listBoards().size());
        assertSame(privateCard, cards.getCard(privateCard.getId()));
        boards.updateBoard(shared.getId(), new Board("Admin rename", "ignored"));
        boards.addMember(shared.getId(), request("dave"));
        boards.removeMember(shared.getId(), "dave");
        assertEquals("alice", shared.getOwner());
        assertEquals(204, boards.deleteBoard(shared.getId()).getStatus());
    }

    @Test void deletingABoardCleansOnlyItsOwnMembershipsColumnsAndCards() {
        memberData.add(new BoardMember(foreign.getId(), "other"));
        user.name = "alice";
        boards.deleteBoard(shared.getId());
        assertEquals(List.of(foreign), new ArrayList<>(boardData.rows.values()));
        assertEquals(List.of(privateColumn), new ArrayList<>(columnData.rows.values()));
        assertEquals(List.of(privateCard), new ArrayList<>(cardData.rows.values()));
        assertEquals(List.of("other"), memberData.rows.values().stream().map(BoardMember::getUsername).toList());
    }

    @Test void missingBoardOrMemberReturns404ToAnAuthorizedCaller() {
        user.name = "alice";
        assertEquals(404, assertThrows(WebApplicationException.class, () -> boards.getBoard(999L)).getResponse().getStatus());
        assertEquals(404, assertThrows(WebApplicationException.class, () -> boards.removeMember(shared.getId(), "unknown")).getResponse().getStatus());
    }

    @Test void orphanedColumnsAndCardsCannotGrantAccess() {
        BoardList orphan = columnData.add(new BoardList(999L, "Orphan", 0));
        Card orphanCard = cardData.add(new Card(999L, "Orphan", 0));
        assertThrows(ForbiddenException.class, () -> columns.getColumn(orphan.getId()));
        assertThrows(ForbiddenException.class, () -> cards.getCard(orphanCard.getId()));
    }

    private void assertCollaboratorDenied() {
        List<Executable> actions = List.of(
            () -> boards.getBoard(shared.getId()), () -> boards.listMembers(shared.getId()),
            () -> boards.listColumns(shared.getId()), () -> boards.addColumn(shared.getId(), new BoardList(0, "Denied", 0)),
            () -> columns.getColumn(source.getId()), () -> columns.updateColumn(source.getId(), new BoardList(0, "Denied", 0)),
            () -> columns.deleteColumn(source.getId()), () -> columns.listCards(source.getId()),
            () -> columns.addCard(source.getId(), new Card(0, "Denied", 0)),
            () -> cards.getCard(card.getId()), () -> cards.updateCard(card.getId(), new Card(0, "Denied", 0)),
            () -> cards.deleteCard(card.getId()), () -> cards.move(card.getId(), new MoveCommand(target.getId(), 0))
        );
        actions.forEach(action -> assertThrows(ForbiddenException.class, action));
    }

    private static BoardResource.MemberRequest request(String name) {
        BoardResource.MemberRequest request = new BoardResource.MemberRequest(); request.username = name; return request;
    }
    private static final class TestUser extends CurrentUser {
        String name; boolean admin;
        @Override public String name() { return name; }
        @Override public boolean isAdmin() { return admin; }
    }
    private static void inject(Object target, String field, Object value) {
        try { var f = target.getClass().getDeclaredField(field); f.setAccessible(true); f.set(target, value); }
        catch (ReflectiveOperationException e) { throw new AssertionError(e); }
    }
    private static UriInfo uriInfo() {
        return (UriInfo) Proxy.newProxyInstance(UriInfo.class.getClassLoader(), new Class<?>[]{UriInfo.class},
            (proxy, method, args) -> switch (method.getName()) {
                case "getAbsolutePathBuilder" -> UriBuilder.fromUri("http://localhost/api/boards");
                case "getBaseUriBuilder" -> UriBuilder.fromUri("http://localhost/api/");
                default -> throw new UnsupportedOperationException(method.getName());
            });
    }

    /** A deliberately small fake: unhandled repository calls fail the test. */
    @SuppressWarnings("unchecked") // Repository proxies are bound to their entity type in setUp().
    private static final class Memory<T> implements InvocationHandler {
        final Map<Long, T> rows = new LinkedHashMap<>();
        long nextId = 1;
        T add(T entity) {
            try {
                Long id = (Long) property(entity, "Id");
                if (id == null) { id = nextId++; entity.getClass().getMethod("setId", Long.class).invoke(entity, id); }
                rows.put(id, entity); return entity;
            } catch (ReflectiveOperationException e) { throw new AssertionError(e); }
        }
        <R> R repository(Class<R> type) {
            return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, this));
        }
        List<T> matching(Predicate<T> predicate, String sort) {
            var stream = rows.values().stream().filter(predicate);
            if (sort != null) stream = stream.sorted(Comparator.comparing(x -> (Comparable<Object>) property(x, sort)));
            return stream.toList();
        }
        @Override public Object invoke(Object proxy, Method method, Object[] args) {
            return switch (method.getName()) {
                case "insert", "save" -> add((T) args[0]);
                case "saveAll" -> { List<T> saved = new ArrayList<>(); for (T row : (Iterable<T>) args[0]) saved.add(add(row)); yield saved; }
                case "findById" -> Optional.ofNullable(rows.get((Long) args[0]));
                case "findAllSortedByName" -> matching(x -> true, "Name");
                case "findByOwnerOrderByNameAsc" -> matching(x -> Objects.equals(property(x, "Owner"), args[0]), "Name");
                case "findByBoardId" -> matching(x -> Objects.equals(property(x, "BoardId"), args[0]), null);
                case "findByUsername" -> matching(x -> Objects.equals(property(x, "Username"), args[0]), null);
                case "findByBoardIdAndUsername" -> rows.values().stream().filter(x -> Objects.equals(property(x, "BoardId"), args[0]) && Objects.equals(property(x, "Username"), args[1])).findFirst();
                case "findByBoardIdOrderByPositionAsc" -> matching(x -> Objects.equals(property(x, "BoardId"), args[0]), "Position");
                case "findByListIdOrderByPositionAsc" -> matching(x -> Objects.equals(property(x, "ListId"), args[0]), "Position");
                case "countByListId" -> (long) matching(x -> Objects.equals(property(x, "ListId"), args[0]), null).size();
                case "delete" -> { rows.remove((Long) property(args[0], "Id")); yield null; }
                case "deleteByBoardId" -> { rows.values().removeIf(x -> Objects.equals(property(x, "BoardId"), args[0])); yield null; }
                case "deleteByListId" -> { rows.values().removeIf(x -> Objects.equals(property(x, "ListId"), args[0])); yield null; }
                default -> throw new UnsupportedOperationException(method.getName());
            };
        }
        private static Object property(Object entity, String name) {
            try { return entity.getClass().getMethod("get" + name).invoke(entity); }
            catch (ReflectiveOperationException e) { throw new AssertionError(e); }
        }
    }
}
