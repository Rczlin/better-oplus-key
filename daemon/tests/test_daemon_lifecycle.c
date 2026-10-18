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
    /* 绑定命令的子进程不得继承指向模块目录文件的 stdio（否则 cmd/input 报 Failed transaction 退出码 2）。 */
    child = fork();
    CHECK(child >= 0);
    if (child == 0) {
        int log_fd = open(g_log_path, O_WRONLY | O_CREAT | O_APPEND, 0600);
        if (log_fd < 0 || dup2(log_fd, 1) < 0 || dup2(log_fd, 2) < 0) _exit(20);
        if (setup_child_stdio(-1) != 0) _exit(21);
        struct stat null_st, fd_st;
        if (stat("/dev/null", &null_st) != 0) _exit(22);
        for (int fd = 0; fd <= 2; fd++) {
            if (fstat(fd, &fd_st) != 0 || !S_ISCHR(fd_st.st_mode) || fd_st.st_rdev != null_st.st_rdev) _exit(23 + fd);
            if (fcntl(fd, F_GETFD) & FD_CLOEXEC) _exit(26);
        }
        _exit(0);
    }
    CHECK(waitpid(child, &status, 0) == child);
    CHECK(WIFEXITED(status) && WEXITSTATUS(status) == 0);
    /* 捕获输出时：stdin 为 /dev/null，stdout/stderr 为管道（不是模块目录里的文件）。 */
    int pfds[2];
    CHECK(pipe2(pfds, O_CLOEXEC) == 0);
    child = fork();
    CHECK(child >= 0);
    if (child == 0) {
        if (setup_child_stdio(pfds[1]) != 0) _exit(30);
        struct stat null_st, fd_st;
        if (stat("/dev/null", &null_st) != 0) _exit(31);
        if (fstat(0, &fd_st) != 0 || fd_st.st_rdev != null_st.st_rdev || !S_ISCHR(fd_st.st_mode)) _exit(32);
        for (int fd = 1; fd <= 2; fd++)
            if (fstat(fd, &fd_st) != 0 || !S_ISFIFO(fd_st.st_mode) || (fcntl(fd, F_GETFD) & FD_CLOEXEC)) _exit(33);
        _exit(0);
    }
    close(pfds[0]); close(pfds[1]);
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
