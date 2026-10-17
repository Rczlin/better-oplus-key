#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <sys/wait.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static int reap_calls;
static pid_t fake_waitpid(pid_t pid, int *status, int options) {
    (void)pid; (void)status; (void)options;
    if (++reap_calls == 1) { errno = EINTR; return -1; }
    raise(SIGCHLD);
    return 0;
}
static int test_ppoll(struct pollfd *fds, nfds_t n, const struct timespec *timeout, const sigset_t *mask) {
    /* Deliver after the final flag check, while signals are blocked. */
    raise(SIGHUP);
    return ppoll(fds, n, timeout, mask);
}
#define waitpid fake_waitpid
#define ppoll test_ppoll
#define main daemon_test_main
#include "../src/main.c"
#undef main
#undef waitpid
#undef ppoll

static int failures;
#define CHECK(c) do { if (!(c)) { fprintf(stderr,"FAIL %d: %s\n",__LINE__,#c); failures++; } } while (0)

int main(void) {
    char dir[] = "/tmp/sidekey-lifecycle-XXXXXX";
    CHECK(mkdtemp(dir) != NULL);
    CHECK(setup_paths(dir) == 0);
    CHECK(acquire_instance_lock() == 0);
    CHECK(write_pid() == 0);
    pid_t child = fork();
    CHECK(child >= 0);
    if (child == 0) {
        close(g_lock_fd); g_lock_fd = -1; g_pid_owned = 0;
        if (acquire_instance_lock() == 0) _exit(10);
        remove_pid();
        _exit(access(g_pid_path, F_OK) == 0 ? 0 : 11);
    }
    int status;
    CHECK(waitpid(child, &status, 0) == child);
    CHECK(WIFEXITED(status) && WEXITSTATUS(status) == 0);
    struct sigaction sa = {0};
    sa.sa_handler = on_hup; sigaction(SIGHUP, &sa, NULL);
    sa.sa_handler = on_chld; sigaction(SIGCHLD, &sa, NULL);
    g_child_done = 0; reap_calls = 0;
    reap_children();
    CHECK(reap_calls == 2 && g_child_done == 1);
    g_child_done = 0;
    long long start = mono_ms();
    CHECK(wait_for_input(80) == 0);
    CHECK(g_reload == 1 && mono_ms() - start < 60);
    sigset_t mask; sigprocmask(SIG_SETMASK, NULL, &mask);
    CHECK(!sigismember(&mask, SIGHUP));
    char seq[2049]; memset(seq, '0', 2048); seq[2048] = 0;
    CHECK(remember_inflight(123, seq, "echo old") == 0);
    CHECK(strlen(g_inflight[0].seq) == 2048);
    seq[0] = '1';
    CHECK(g_inflight[0].seq[0] == '0');
    log_seq(g_inflight[0].seq, g_inflight[0].action, -3);
    FILE *f = fopen(g_log_path, "rb"); char line[4096] = {0};
    CHECK(f != NULL);
    if (f) { CHECK(fread(line, 1, sizeof(line)-1, f) > 2048); fclose(f); }
    CHECK(strstr(line, "action=echo old result=-3\n") != NULL);
    free(g_inflight[0].seq); free(g_inflight[0].action);
    remove_pid(); CHECK(access(g_pid_path, F_OK) != 0);
    close(g_lock_fd); unlink(g_lock_path); unlink(g_log_path); rmdir(dir);
    return failures ? 1 : 0;
}
