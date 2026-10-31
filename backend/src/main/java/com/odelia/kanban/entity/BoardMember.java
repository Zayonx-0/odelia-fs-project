package com.odelia.kanban.entity;

import jakarta.persistence.*;

@Entity
@Table(name = "BOARD_MEMBER", uniqueConstraints = @UniqueConstraint(columnNames = {"BOARD_ID", "USERNAME"}))
public class BoardMember {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "BOARD_ID", nullable = false)
    private Long boardId;
    @Column(name = "USERNAME", nullable = false, length = 120)
    private String username;

    public BoardMember() { }
    public BoardMember(Long boardId, String username) { this.boardId = boardId; this.username = username; }
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getBoardId() { return boardId; }
    public void setBoardId(Long boardId) { this.boardId = boardId; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
}
