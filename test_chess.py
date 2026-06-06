"""Tests for chess.py."""

import pytest
from chess import Board, Piece, parse_move


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_board_from_fen(fen: str) -> Board:
    """Build a Board from the piece-placement part of a FEN string."""
    parts = fen.split()
    placement = parts[0]
    b = Board()
    b.grid = [[None] * 8 for _ in range(8)]
    b.castling_rights = {
        'white': {'kingside': False, 'queenside': False},
        'black': {'kingside': False, 'queenside': False},
    }
    b.en_passant_target = None

    row = 7
    col = 0
    for ch in placement:
        if ch == '/':
            row -= 1
            col = 0
        elif ch.isdigit():
            col += int(ch)
        else:
            color = 'white' if ch.isupper() else 'black'
            b.grid[row][col] = Piece(color, ch.upper())
            col += 1

    if len(parts) > 1:
        b.turn = 'white' if parts[1] == 'w' else 'black'
    if len(parts) > 2:
        cr = parts[2]
        b.castling_rights['white']['kingside'] = 'K' in cr
        b.castling_rights['white']['queenside'] = 'Q' in cr
        b.castling_rights['black']['kingside'] = 'k' in cr
        b.castling_rights['black']['queenside'] = 'q' in cr
    if len(parts) > 3 and parts[3] != '-':
        b.en_passant_target = Board.parse_square(parts[3])

    return b


def move(board: Board, s: str) -> bool:
    from_sq, to_sq, promo = parse_move(s)
    return board.make_move(from_sq, to_sq, promo)


# ---------------------------------------------------------------------------
# Basic movement
# ---------------------------------------------------------------------------

class TestPawnMoves:
    def test_white_pawn_single_push(self):
        b = Board()
        assert move(b, 'e2e3')

    def test_white_pawn_double_push(self):
        b = Board()
        assert move(b, 'e2e4')

    def test_pawn_cannot_push_three_squares(self):
        b = Board()
        assert not move(b, 'e2e5')

    def test_pawn_cannot_move_backward(self):
        b = Board()
        assert not move(b, 'e2e1')

    def test_pawn_capture_diagonal(self):
        b = make_board_from_fen('8/8/8/3p4/4P3/8/8/8 w - -')
        assert move(b, 'e4d5')

    def test_pawn_cannot_capture_forward(self):
        b = make_board_from_fen('8/8/8/4p3/4P3/8/8/8 w - -')
        assert not move(b, 'e4e5')


class TestKnightMoves:
    def test_knight_from_starting_position(self):
        b = Board()
        assert move(b, 'g1f3')

    def test_knight_l_shape(self):
        b = make_board_from_fen('8/8/8/8/4N3/8/8/8 w - -')
        assert move(b, 'e4f6')

    def test_knight_cannot_move_straight(self):
        b = make_board_from_fen('8/8/8/8/4N3/8/8/8 w - -')
        assert not move(b, 'e4e6')


class TestBishopMoves:
    def test_bishop_diagonal(self):
        b = make_board_from_fen('8/8/8/8/8/8/8/4B3 w - -')
        assert move(b, 'e1h4')

    def test_bishop_blocked(self):
        b = Board()
        assert not move(b, 'c1e3')


class TestRookMoves:
    def test_rook_horizontal(self):
        b = make_board_from_fen('8/8/8/8/4R3/8/8/8 w - -')
        assert move(b, 'e4a4')

    def test_rook_vertical(self):
        b = make_board_from_fen('8/8/8/8/4R3/8/8/8 w - -')
        assert move(b, 'e4e8')

    def test_rook_blocked_by_own_piece(self):
        b = Board()
        assert not move(b, 'a1a3')


class TestQueenMoves:
    def test_queen_diagonal(self):
        b = make_board_from_fen('8/8/8/8/8/8/8/3Q4 w - -')
        assert move(b, 'd1h5')

    def test_queen_straight(self):
        b = make_board_from_fen('8/8/8/8/8/8/8/3Q4 w - -')
        assert move(b, 'd1d8')


class TestKingMoves:
    def test_king_one_square(self):
        b = make_board_from_fen('8/8/8/8/8/8/8/4K3 w - -')
        assert move(b, 'e1e2')

    def test_king_cannot_move_two_squares_without_castling(self):
        b = make_board_from_fen('8/8/8/8/8/8/8/4K3 w - -')
        assert not move(b, 'e1e3')


# ---------------------------------------------------------------------------
# Check and checkmate
# ---------------------------------------------------------------------------

class TestCheck:
    def test_cannot_move_into_check(self):
        # King on e1, Black rook on e8: moving king to e2 walks into check
        b = make_board_from_fen('4r3/8/8/8/8/8/8/4K3 w - -')
        assert not move(b, 'e1e2')

    def test_must_escape_check(self):
        # White king in check from rook on e8; must block or move
        b = make_board_from_fen('4r3/8/8/8/8/8/8/4K3 w - -')
        assert move(b, 'e1d1')  # side-step

    def test_is_in_check_detected(self):
        b = make_board_from_fen('4r3/8/8/8/8/8/8/4K3 w - -')
        assert b.is_in_check('white')

    def test_not_in_check(self):
        b = Board()
        assert not b.is_in_check('white')


class TestCheckmate:
    def test_scholars_mate(self):
        """Fool's mate — fastest checkmate in 2 moves."""
        b = Board()
        assert move(b, 'f2f3')
        assert move(b, 'e7e5')
        assert move(b, 'g2g4')
        assert move(b, 'd8h4')
        assert b.is_checkmate()

    def test_not_checkmate_at_start(self):
        b = Board()
        assert not b.is_checkmate()


class TestStalemate:
    def test_stalemate_position(self):
        # Black king on a8, White queen on b6, White king on c6 — stalemate
        b = make_board_from_fen('k7/8/1QK5/8/8/8/8/8 b - -')
        assert b.is_stalemate()

    def test_not_stalemate_at_start(self):
        b = Board()
        assert not b.is_stalemate()


# ---------------------------------------------------------------------------
# Special moves
# ---------------------------------------------------------------------------

class TestEnPassant:
    def test_en_passant_capture(self):
        # White pawn on e5, Black plays d7d5 → White can capture en passant
        b = make_board_from_fen('8/3p4/8/4P3/8/8/8/8 w - -')
        b.turn = 'black'
        assert move(b, 'd7d5')
        assert b.en_passant_target == Board.parse_square('d6')
        assert move(b, 'e5d6')
        assert b.grid[Board.parse_square('d5')[0]][Board.parse_square('d5')[1]] is None

    def test_en_passant_target_cleared_after_other_move(self):
        b = make_board_from_fen('8/3p4/8/4P3/8/8/8/K6k w - -')
        b.turn = 'black'
        move(b, 'd7d5')
        # White plays a non-capturing move
        move(b, 'a1b1')
        assert b.en_passant_target is None


class TestCastling:
    def test_kingside_castling_white(self):
        b = make_board_from_fen('8/8/8/8/8/8/8/4K2R w KQ -')
        assert move(b, 'e1g1')
        assert b.grid[0][6] is not None and b.grid[0][6].symbol == 'K'
        assert b.grid[0][5] is not None and b.grid[0][5].symbol == 'R'

    def test_queenside_castling_white(self):
        b = make_board_from_fen('8/8/8/8/8/8/8/R3K3 w KQ -')
        assert move(b, 'e1c1')
        assert b.grid[0][2] is not None and b.grid[0][2].symbol == 'K'
        assert b.grid[0][3] is not None and b.grid[0][3].symbol == 'R'

    def test_cannot_castle_through_check(self):
        # Black rook attacks f1, so kingside castling is illegal
        b = make_board_from_fen('5r2/8/8/8/8/8/8/4K2R w KQ -')
        assert not move(b, 'e1g1')

    def test_cannot_castle_while_in_check(self):
        b = make_board_from_fen('4r3/8/8/8/8/8/8/4K2R w KQ -')
        assert not move(b, 'e1g1')

    def test_castling_rights_revoked_on_king_move(self):
        b = make_board_from_fen('8/8/8/8/8/8/8/4K2R w KQ -')
        move(b, 'e1d1')
        b.turn = 'white'
        assert not b.castling_rights['white']['kingside']
        assert not b.castling_rights['white']['queenside']

    def test_castling_rights_revoked_on_rook_move(self):
        b = make_board_from_fen('8/8/8/8/8/8/8/4K2R w KQ -')
        move(b, 'h1h2')
        b.turn = 'white'
        assert not b.castling_rights['white']['kingside']


class TestPromotion:
    def test_pawn_promotes_to_queen(self):
        b = make_board_from_fen('8/4P3/8/8/8/8/8/8 w - -')
        assert move(b, 'e7e8Q')
        p = b.grid[7][4]
        assert p is not None and p.symbol == 'Q' and p.color == 'white'

    def test_pawn_promotes_to_knight(self):
        b = make_board_from_fen('8/4P3/8/8/8/8/8/8 w - -')
        assert move(b, 'e7e8N')
        p = b.grid[7][4]
        assert p is not None and p.symbol == 'N'

    def test_pawn_cannot_advance_past_promotion_rank(self):
        b = make_board_from_fen('8/4P3/8/8/8/8/8/8 w - -')
        # Already on rank 7; must promote, cannot stay as pawn
        assert move(b, 'e7e8Q')
        assert b.grid[7][4].symbol != 'P'


# ---------------------------------------------------------------------------
# FEN output
# ---------------------------------------------------------------------------

class TestFEN:
    def test_starting_fen(self):
        b = Board()
        fen = b.to_fen()
        assert fen.startswith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')
        assert ' w ' in fen

    def test_fen_after_e4(self):
        b = Board()
        move(b, 'e2e4')
        fen = b.to_fen()
        assert 'e3' in fen  # en passant target


# ---------------------------------------------------------------------------
# parse_move
# ---------------------------------------------------------------------------

class TestParseMMove:
    def test_basic(self):
        f, t, p = parse_move('e2e4')
        assert f == (1, 4) and t == (3, 4) and p == 'Q'

    def test_with_dash(self):
        f, t, p = parse_move('e2-e4')
        assert f == (1, 4) and t == (3, 4)

    def test_promotion(self):
        f, t, p = parse_move('e7e8n')
        assert p == 'N'

    def test_invalid(self):
        f, t, p = parse_move('xyz')
        assert f is None
